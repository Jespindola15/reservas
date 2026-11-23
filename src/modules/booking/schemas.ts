import { z } from "zod";

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);

export const uuidSchema = z.uuid();

export const operatingDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (AAAA-MM-DD)");

export const durationSchema = z.coerce.number().int().min(15).max(720);

export const idempotencyKeySchema = z
  .string()
  .min(16)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/, "Clave de idempotencia inválida");

const phoneSchema = trimmed(6, 30).regex(/^[0-9+()\s.-]+$/, "Teléfono inválido");

/** Solicitud pública de reserva (página del complejo). Todo lo demás lo decide el servidor. */
export const publicBookingRequestSchema = z.object({
  courtId: uuidSchema,
  startsAt: z.iso.datetime({ offset: true }),
  durationMinutes: durationSchema,
  customer: z.object({
    name: trimmed(2, 80),
    phone: phoneSchema,
    email: z.email().max(254),
  }),
  notes: trimmed(0, 500).optional(),
  idempotencyKey: idempotencyKeySchema,
});
export type PublicBookingRequest = z.infer<typeof publicBookingRequestSchema>;

/** Reserva manual cargada por el complejo: el email es opcional. */
export const manualBookingRequestSchema = z.object({
  courtId: uuidSchema,
  startsAt: z.iso.datetime({ offset: true }),
  durationMinutes: durationSchema,
  customer: z.object({
    name: trimmed(2, 80),
    phone: phoneSchema,
    email: z.email().max(254).optional(),
  }),
  notes: trimmed(0, 500).optional(),
  idempotencyKey: idempotencyKeySchema,
});
export type ManualBookingRequest = z.infer<typeof manualBookingRequestSchema>;

export const availabilityQuerySchema = z.object({
  date: operatingDateSchema,
  duration: durationSchema,
  courtId: uuidSchema.optional(),
});

export const rescheduleSchema = z.object({
  bookingId: uuidSchema,
  startsAt: z.iso.datetime({ offset: true }),
  durationMinutes: durationSchema,
  courtId: uuidSchema.optional(),
  expectedVersion: z.coerce.number().int().min(1),
});

export const statusChangeSchema = z.object({
  bookingId: uuidSchema,
  expectedVersion: z.coerce.number().int().min(1),
  reason: trimmed(0, 300).optional(),
});

export const blockSchema = z
  .object({
    courtId: uuidSchema,
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    reason: trimmed(2, 200),
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), { message: "El fin debe ser posterior al inicio" });
