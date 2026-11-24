import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/db/prisma";
import { createBooking, rescheduleBooking } from "@/modules/booking/service";
import { getDayAvailability } from "@/modules/booking/availability";
import {
  addCourtImage,
  addPriceRule,
  createCourt,
  createScheduleException,
  deleteCourt,
  deletePriceRule,
  getCourtAdmin,
  replaceWeeklySchedule,
  setCourtActive,
  sniffImageType,
  updateCourt,
} from "@/modules/courts/service";
import { updateTenantSettings } from "@/modules/tenant/settings";
import { DAY, NOW, appRole, at, makeTenant, onlineInput, owner, publicActor, resetDb, type Fixture } from "../support/fixtures";

const opts = { now: NOW };
const admin = { type: "USER" as const, userId: null };

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

let f: Fixture;
let g: Fixture;

beforeEach(async () => {
  await resetDb();
  f = await makeTenant("canchas-a");
  g = await makeTenant("canchas-b");
});

afterAll(async () => {
  await prisma.$disconnect();
  await owner.$disconnect();
  await appRole.$disconnect();
});

const baseCourt = {
  name: "Cancha Nueva",
  sport: "FOOTBALL_7" as const,
  description: "Sintético",
  capacity: 14,
  allowedDurations: [60, 90],
  slotStepMinutes: 30,
  basePrice: 4_000_000,
};

describe("creación y edición de canchas", () => {
  it("crea, edita, desactiva y reactiva una cancha", async () => {
    const c = await createCourt(f.ctx, baseCourt, admin);
    let got = await getCourtAdmin(f.ctx, c.id);
    expect(got).toMatchObject({ name: "Cancha Nueva", sport: "FOOTBALL_7", capacity: 14, allowedDurations: [60, 90], isActive: true });

    await updateCourt(f.ctx, c.id, { ...baseCourt, name: "F7 Techada", allowedDurations: [120, 60], capacity: null }, admin);
    got = await getCourtAdmin(f.ctx, c.id);
    expect(got).toMatchObject({ name: "F7 Techada", allowedDurations: [60, 120], capacity: null });

    await setCourtActive(f.ctx, c.id, false, admin);
    expect((await getCourtAdmin(f.ctx, c.id)).isActive).toBe(false);
    const logs = await owner.auditLog.findMany({ where: { entityId: c.id }, orderBy: { createdAt: "asc" } });
    expect(logs.map((l) => l.action)).toEqual(["court.created", "court.updated", "court.deactivated"]);
  });

  it("valida datos: duración fuera de 60/90/120, capacidad y nombre", async () => {
    await expectCode(createCourt(f.ctx, { ...baseCourt, allowedDurations: [45] }, admin), "VALIDATION_ERROR");
    await expectCode(createCourt(f.ctx, { ...baseCourt, capacity: 500 }, admin), "VALIDATION_ERROR");
    await expectCode(createCourt(f.ctx, { ...baseCourt, name: "" }, admin), "VALIDATION_ERROR");
    await expectCode(createCourt(f.ctx, { ...baseCourt, sport: "TENIS" as never }, admin), "VALIDATION_ERROR");
  });

  it("una cancha desactivada no acepta reservas nuevas", async () => {
    await setCourtActive(f.ctx, f.court.id, false, admin);
    await expectCode(createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, opts), "COURT_NOT_FOUND");
    const day = await getDayAvailability(f.ctx, { operatingDate: DAY, durationMinutes: 60 }, opts);
    expect(day.courts.map((c) => c.id)).not.toContain(f.court.id);
  });

  it("no se elimina físicamente una cancha con historial; sí una sin reservas", async () => {
    await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, opts);
    await expectCode(deleteCourt(f.ctx, f.court.id, admin), "COURT_HAS_HISTORY");
    expect(await owner.court.count({ where: { id: f.court.id } })).toBe(1);
    const nueva = await createCourt(f.ctx, baseCourt, admin);
    await deleteCourt(f.ctx, nueva.id, admin);
    expect(await owner.court.count({ where: { id: nueva.id } })).toBe(0);
  });

  it("no se puede editar, desactivar ni borrar una cancha de otro complejo", async () => {
    await expectCode(updateCourt(f.ctx, g.court.id, baseCourt, admin), "COURT_NOT_FOUND");
    await expectCode(setCourtActive(f.ctx, g.court.id, false, admin), "COURT_NOT_FOUND");
    await expectCode(deleteCourt(f.ctx, g.court.id, admin), "COURT_NOT_FOUND");
    await expectCode(replaceWeeklySchedule(f.ctx, [g.court.id], [], admin), "COURT_NOT_FOUND");
    await expectCode(addPriceRule(f.ctx, g.court.id, { durationMinutes: 60, weekdays: [], startMinute: null, endMinute: null, specialDate: null, amount: 1 }, admin), "COURT_NOT_FOUND");
    expect((await owner.court.findUniqueOrThrow({ where: { id: g.court.id } })).isActive).toBe(true);
  });
});

describe("horarios", () => {
  it("cambiar el horario semanal cambia los turnos ofrecidos y rechaza reservas fuera de horario", async () => {
    // Martes (2030-03-05 es martes = 2): solo 10:00 a 14:00.
    await replaceWeeklySchedule(f.ctx, [f.court.id], [{ weekday: 2, openMinute: 600, closeMinute: 840 }], admin);
    const day = await getDayAvailability(f.ctx, { operatingDate: DAY, durationMinutes: 60, courtId: f.court.id }, opts);
    const starts = day.courts[0]!.slots.map((s) => s.startsAt);
    expect(starts[0]).toBe(at(DAY, "10:00").toISOString());
    expect(starts.at(-1)).toBe(at(DAY, "13:00").toISOString());
    await expectCode(createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, opts), "INVALID_SLOT");
    await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "10:00"), 60), publicActor, opts);
    // Miércoles quedó cerrado.
    await expectCode(createBooking(f.ctx, onlineInput(f.court.id, at("2030-03-06", "10:00"), 60), publicActor, opts), "INVALID_SLOT");
  });

  it("acepta horarios que cruzan medianoche y rechaza franjas superpuestas", async () => {
    await replaceWeeklySchedule(f.ctx, [f.court.id], [{ weekday: 2, openMinute: 1260, closeMinute: 1620 }], admin); // 21:00 a 03:00
    await createBooking(f.ctx, onlineInput(f.court.id, at("2030-03-06", "01:30"), 90), publicActor, opts);
    await expectCode(
      replaceWeeklySchedule(f.ctx, [f.court.id], [
        { weekday: 2, openMinute: 600, closeMinute: 900 },
        { weekday: 2, openMinute: 800, closeMinute: 1000 },
      ], admin),
      "VALIDATION_ERROR",
    );
  });

  it("aplica un horario a varias canchas a la vez", async () => {
    await replaceWeeklySchedule(f.ctx, [f.court.id, f.court2.id], [{ weekday: 2, openMinute: 480, closeMinute: 600 }], admin);
    expect(await owner.courtScheduleRule.count({ where: { tenantId: f.tenant.id } })).toBe(2);
  });

  it("un feriado del complejo cierra todas las canchas ese día", async () => {
    await createScheduleException(f.ctx, { courtId: null, date: DAY, kind: "CLOSED", openMinute: null, closeMinute: null, reason: "Feriado nacional" }, admin);
    const day = await getDayAvailability(f.ctx, { operatingDate: DAY, durationMinutes: 60 }, opts);
    expect(day.courts.every((c) => c.slots.length === 0 && c.closedReason === "Feriado nacional")).toBe(true);
    await expectCode(createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, opts), "INVALID_SLOT");
    // También para reservas manuales.
    await expectCode(createBooking(f.ctx, { ...onlineInput(f.court2.id, at(DAY, "09:00")), source: "MANUAL" }, publicActor, opts), "INVALID_SLOT");
    // El día siguiente sigue normal.
    await createBooking(f.ctx, onlineInput(f.court.id, at("2030-03-06", "20:00")), publicActor, opts);
  });

  it("un día especial reemplaza el horario solo de esa cancha", async () => {
    await createScheduleException(f.ctx, { courtId: f.court.id, date: DAY, kind: "SPECIAL_HOURS", openMinute: 900, closeMinute: 1020, reason: "Torneo" }, admin);
    await expectCode(createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, opts), "INVALID_SLOT");
    await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "15:00"), 60), publicActor, opts);
    await createBooking(f.ctx, onlineInput(f.court2.id, at(DAY, "20:00")), publicActor, opts); // la otra cancha no cambia
  });

  it("no permite reprogramar hacia un día cerrado", async () => {
    const r = await createBooking(f.ctx, onlineInput(f.court.id, at("2030-03-06", "20:00")), publicActor, opts);
    await createScheduleException(f.ctx, { courtId: null, date: DAY, kind: "CLOSED", openMinute: null, closeMinute: null, reason: "Cierre" }, admin);
    await expectCode(
      rescheduleBooking(f.ctx, { bookingId: r.booking.id, startsAt: at(DAY, "20:00"), durationMinutes: 90, expectedVersion: 1 }, publicActor, opts),
      "INVALID_SLOT",
    );
  });
});

describe("tarifas", () => {
  async function onlyRules(...rules: Parameters<typeof addPriceRule>[2][]) {
    await owner.courtPriceRule.deleteMany({ where: { courtId: f.court.id } });
    for (const r of rules) await addPriceRule(f.ctx, f.court.id, r, admin);
  }
  const priceAt = async (date: string, hhmm: string, duration = 60) => {
    const day = await getDayAvailability(f.ctx, { operatingDate: date, durationMinutes: duration, courtId: f.court.id }, opts);
    return day.courts[0]!.slots.find((s) => s.startsAt === at(date, hhmm).toISOString())?.priceAmount;
  };

  it("precio según duración, día, franja, fin de semana y fecha especial", async () => {
    await onlyRules(
      { durationMinutes: 60, weekdays: [], startMinute: null, endMinute: null, specialDate: null, amount: 10_000 },
      { durationMinutes: 90, weekdays: [], startMinute: null, endMinute: null, specialDate: null, amount: 14_000 },
      { durationMinutes: 60, weekdays: [], startMinute: 1080, endMinute: 1560, specialDate: null, amount: 15_000 },
      { durationMinutes: 60, weekdays: [6, 7], startMinute: null, endMinute: null, specialDate: null, amount: 18_000 },
      { durationMinutes: 60, weekdays: [], startMinute: null, endMinute: null, specialDate: "2030-03-07", amount: 25_000 },
    );
    expect(await priceAt(DAY, "09:00")).toBe(10_000); // martes mañana
    expect(await priceAt(DAY, "09:00", 90)).toBe(14_000); // otra duración
    expect(await priceAt(DAY, "20:00")).toBe(15_000); // franja nocturna
    expect(await priceAt("2030-03-09", "09:00")).toBe(18_000); // sábado
    expect(await priceAt("2030-03-10", "09:00")).toBe(18_000); // domingo
    expect(await priceAt("2030-03-07", "20:00")).toBe(25_000); // fecha especial gana
    expect(await owner.courtPriceRule.count({ where: { courtId: f.court.id, weekday: { in: [6, 7] } } })).toBe(2);
  });

  it("sin reglas usa el precio base prorrateado por duración", async () => {
    await owner.courtPriceRule.deleteMany({ where: { courtId: f.court.id } });
    await updateCourt(f.ctx, f.court.id, { ...baseCourt, sport: "PADEL", allowedDurations: [60, 90, 120], basePrice: 20_000 }, admin);
    expect(await priceAt(DAY, "09:00", 90)).toBe(30_000);
  });

  it("el precio de una reserva confirmada se conserva aunque cambien las tarifas", async () => {
    await onlyRules({ durationMinutes: 60, weekdays: [], startMinute: null, endMinute: null, specialDate: null, amount: 10_000 });
    const r = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "09:00"), 60), publicActor, opts);
    expect(r.booking.priceAmount).toBe(10_000);
    const rule = await owner.courtPriceRule.findFirstOrThrow({ where: { courtId: f.court.id } });
    await deletePriceRule(f.ctx, rule.id, admin);
    await addPriceRule(f.ctx, f.court.id, { durationMinutes: 60, weekdays: [], startMinute: null, endMinute: null, specialDate: null, amount: 99_000 }, admin);
    expect((await owner.booking.findUniqueOrThrow({ where: { id: r.booking.id } })).priceAmount).toBe(10_000);
    expect(await priceAt(DAY, "10:00")).toBe(99_000);
  });

  it("valida tarifas", async () => {
    await expectCode(addPriceRule(f.ctx, f.court.id, { durationMinutes: 60, weekdays: [], startMinute: 600, endMinute: null, specialDate: null, amount: 1 }, admin), "VALIDATION_ERROR");
    await expectCode(addPriceRule(f.ctx, f.court.id, { durationMinutes: 60, weekdays: [], startMinute: null, endMinute: null, specialDate: null, amount: -5 }, admin), "VALIDATION_ERROR");
    await expectCode(deletePriceRule(g.ctx, (await owner.courtPriceRule.findFirstOrThrow({ where: { courtId: f.court.id } })).id, admin), "NOT_FOUND");
  });
});

describe("imágenes y ajustes", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  it("detecta el tipo por firma y rechaza archivos disfrazados", async () => {
    expect(sniffImageType(png)).toBe("image/png");
    expect(sniffImageType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    // Una firma PNG válida pero con contenido corrupto también se rechaza (se decodifica de verdad).
    await expectCode(addCourtImage(f.ctx, f.court.id, png, admin), "IMAGE_INVALID");
    const sharp = (await import("sharp")).default;
    const real = new Uint8Array(
      await sharp({ create: { width: 2400, height: 1200, channels: 3, background: "#1a7f37" } })
        .withMetadata({ exif: { IFD0: { Copyright: "secreto-gps" } } })
        .jpeg()
        .toBuffer(),
    );
    await addCourtImage(f.ctx, f.court.id, real, admin);
    const saved = await owner.courtImage.findFirstOrThrow({ where: { courtId: f.court.id } });
    // Optimizada: WebP, redimensionada a 1600 px y sin metadatos EXIF.
    expect(saved.contentType).toBe("image/webp");
    expect(saved.width).toBe(1600);
    expect(saved.storage).toBe("DATABASE");
    const meta = await sharp(Buffer.from(saved.data!)).metadata();
    expect(meta.exif).toBeUndefined();
    await expectCode(addCourtImage(f.ctx, f.court.id, new TextEncoder().encode("<html>"), admin), "IMAGE_INVALID");
    await expectCode(addCourtImage(f.ctx, f.court.id, new Uint8Array(1_600_000).fill(0xff), admin), "IMAGE_INVALID");
    await expectCode(addCourtImage(f.ctx, g.court.id, real, admin), "COURT_NOT_FOUND");
  });

  it("limita los ajustes del complejo a rangos seguros", async () => {
    const valid = { name: "Complejo", bookingRequiresApproval: true, minLeadMinutes: 30, maxAdvanceDays: 20, pendingExpirationMinutes: 45, publicCancellationMinutes: 60, notificationsEnabled: true, notifyPlayers: true, notifyOwner: false, ownerNotificationEmail: "", reminderHoursBefore: 3, digestEnabled: false, digestHour: 8 };
    await updateTenantSettings(f.ctx, valid, admin);
    expect((await owner.tenant.findUniqueOrThrow({ where: { id: f.tenant.id } })).pendingExpirationMinutes).toBe(45);
    await expectCode(updateTenantSettings(f.ctx, { ...valid, pendingExpirationMinutes: 1 }, admin), "VALIDATION_ERROR");
    await expectCode(updateTenantSettings(f.ctx, { ...valid, pendingExpirationMinutes: 99_999 }, admin), "VALIDATION_ERROR");
    await expectCode(updateTenantSettings(f.ctx, { ...valid, reminderHoursBefore: 49 }, admin), "VALIDATION_ERROR");
    await expectCode(updateTenantSettings(f.ctx, { ...valid, digestHour: 24 }, admin), "VALIDATION_ERROR");
    await expectCode(updateTenantSettings(f.ctx, { ...valid, ownerNotificationEmail: "no-es-email" }, admin), "VALIDATION_ERROR");
  });
});
