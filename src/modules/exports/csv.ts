import { DateTime } from "luxon";
import type { BookingStatus, Prisma } from "@/generated/prisma/client";
import { audit, type Actor } from "@/lib/audit";
import { withTenant, type TenantContext } from "@/lib/db/tenant-context";
import { AppError } from "@/lib/errors";
import { parseOrThrow } from "@/lib/validation";
import { bookingFiltersSchema, type BookingFilters } from "@/modules/booking/admin-queries";
import { localMidnight } from "@/modules/booking/time";

/** Máximo de filas por exportación: evita respuestas gigantes en funciones serverless. */
export const EXPORT_MAX_ROWS = 10_000;

/**
 * Celda CSV segura:
 *  - comillas dobles escapadas y la celda siempre entre comillas;
 *  - protección contra inyección de fórmulas (CSV injection): si empieza con = + - @ TAB o CR,
 *    se antepone un apóstrofo para que Excel / Sheets lo traten como texto.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  // BOM para que Excel detecte UTF-8 (acentos y ñ). Separador coma, fin de línea CRLF (RFC 4180).
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

const STATUS_ES: Record<string, string> = {
  PENDING: "Pendiente", CONFIRMED: "Confirmada", CANCELLED: "Cancelada", REJECTED: "Rechazada",
  COMPLETED: "Jugada", NO_SHOW: "No se presentó", EXPIRED: "Vencida",
};

export async function exportBookingsCsv(ctx: TenantContext, timezone: string, filters: BookingFilters, actor: Actor) {
  const f = parseOrThrow(bookingFiltersSchema, filters);
  const where: Prisma.BookingWhereInput = { tenantId: ctx.tenantId };
  if (f.status) where.status = f.status as BookingStatus;
  if (f.courtId) where.courtId = f.courtId;
  const startsAt: Prisma.DateTimeFilter = {};
  if (f.from) startsAt.gte = localMidnight(f.from, timezone)?.toJSDate();
  if (f.to) startsAt.lt = localMidnight(f.to, timezone)?.plus({ days: 1 }).toJSDate();
  if (startsAt.gte || startsAt.lt) where.startsAt = startsAt;

  return withTenant(ctx, async (tx) => {
    const count = await tx.booking.count({ where });
    if (count > EXPORT_MAX_ROWS) throw new AppError("LIMIT_REACHED", { resource: "export", max: EXPORT_MAX_ROWS, count });
    const rows = await tx.booking.findMany({
      where,
      orderBy: { startsAt: "asc" },
      select: {
        code: true, status: true, source: true, startsAt: true, endsAt: true, durationMinutes: true,
        priceAmount: true, currency: true, customerName: true, customerPhone: true, customerEmail: true,
        court: { select: { name: true } }, createdAt: true,
      },
    });
    await audit(tx, {
      tenantId: ctx.tenantId, actor, action: "data.exported", entityType: "booking", entityId: null,
      metadata: { kind: "bookings", rows: rows.length, filters: { status: f.status, courtId: f.courtId, from: f.from, to: f.to } },
    });
    const local = (d: Date) => DateTime.fromJSDate(d, { zone: timezone }).toFormat("yyyy-MM-dd HH:mm");
    return toCsv(
      ["Código", "Estado", "Origen", "Cancha", "Inicio (hora local)", "Fin (hora local)", "Minutos", "Precio", "Moneda", "Cliente", "Teléfono", "Email", "Creada (UTC)"],
      rows.map((r) => [
        r.code, STATUS_ES[r.status] ?? r.status, r.source, r.court.name, local(r.startsAt), local(r.endsAt), r.durationMinutes,
        r.priceAmount ?? "", r.currency, r.customerName, r.customerPhone, r.customerEmail ?? "", r.createdAt,
      ]),
    );
  });
}

export async function exportCustomersCsv(ctx: TenantContext, actor: Actor) {
  return withTenant(ctx, async (tx) => {
    const count = await tx.customer.count({ where: { tenantId: ctx.tenantId } });
    if (count > EXPORT_MAX_ROWS) throw new AppError("LIMIT_REACHED", { resource: "export", max: EXPORT_MAX_ROWS, count });
    const rows = await tx.customer.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { name: "asc" },
      select: { name: true, phone: true, email: true, notes: true, createdAt: true, _count: { select: { bookings: true } } },
    });
    await audit(tx, { tenantId: ctx.tenantId, actor, action: "data.exported", entityType: "customer", entityId: null, metadata: { kind: "customers", rows: rows.length } });
    return toCsv(
      ["Nombre", "Teléfono", "Email", "Reservas", "Notas", "Alta (UTC)"],
      rows.map((r) => [r.name, r.phone ?? "", r.email ?? "", r._count.bookings, r.notes ?? "", r.createdAt]),
    );
  });
}
