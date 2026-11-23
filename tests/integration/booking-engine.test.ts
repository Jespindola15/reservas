import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/db/prisma";
import {
  changeBookingStatus,
  createBlock,
  createBooking,
  deleteBlock,
  rescheduleBooking,
} from "@/modules/booking/service";
import { getDayAvailability } from "@/modules/booking/availability";
import {
  DAY,
  NOW,
  at,
  key,
  makeTenant,
  onlineInput,
  owner,
  appRole,
  publicActor,
  resetDb,
  type Fixture,
} from "../support/fixtures";

const opts = { now: NOW };

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

async function allocationCount(courtId: string) {
  return owner.courtAllocation.count({ where: { courtId } });
}

let f: Fixture;

beforeEach(async () => {
  await resetDb();
  f = await makeTenant("padel-test");
});

afterAll(async () => {
  await prisma.$disconnect();
  await owner.$disconnect();
  await appRole.$disconnect();
});

describe("concurrencia", () => {
  it("dos usuarios reservando simultáneamente la misma cancha: solo uno confirma", async () => {
    const start = at(DAY, "20:00");
    const results = await Promise.allSettled([
      createBooking(f.ctx, onlineInput(f.court.id, start, 90, 1), publicActor, opts),
      createBooking(f.ctx, onlineInput(f.court.id, start, 90, 2), publicActor, opts),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0]!.reason as AppError).code).toBe("SLOT_UNAVAILABLE");
    expect(await allocationCount(f.court.id)).toBe(1);
  });

  it("100 solicitudes concurrentes al mismo horario: exactamente 1 éxito y 99 rechazos limpios", async () => {
    const start = at(DAY, "21:00");
    const results = await Promise.allSettled(
      Array.from({ length: 100 }, (_, i) =>
        createBooking(f.ctx, onlineInput(f.court.id, start, 60, i + 1), publicActor, opts),
      ),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    const reasons = results
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => (r.reason instanceof AppError ? r.reason.code : `UNEXPECTED:${String(r.reason)}`));
    expect(ok).toHaveLength(1);
    expect(reasons).toHaveLength(99);
    expect(new Set(reasons)).toEqual(new Set(["SLOT_UNAVAILABLE"]));
    const active = await owner.booking.count({ where: { courtId: f.court.id, status: { in: ["PENDING", "CONFIRMED"] } } });
    expect(active).toBe(1);
    expect(await allocationCount(f.court.id)).toBe(1);
  });

  it("100 solicitudes concurrentes con horarios solapados distintos: nunca quedan dos ocupaciones superpuestas", async () => {
    // Inicios cada 30 min entre 18:00 y 00:30 con 90 min: muchos se pisan entre sí.
    const starts = ["18:00", "18:30", "19:00", "19:30", "20:00", "20:30", "21:00", "21:30", "22:00", "22:30"];
    await Promise.allSettled(
      Array.from({ length: 100 }, (_, i) =>
        createBooking(f.ctx, onlineInput(f.court.id, at(DAY, starts[i % starts.length]!), 90, i + 1), publicActor, opts),
      ),
    );
    const rows = await owner.$queryRaw<{ overlaps: bigint }[]>`
      SELECT count(*) AS overlaps FROM court_allocations a
      JOIN court_allocations b ON a.court_id = b.court_id AND a.id < b.id AND a.period && b.period
    `;
    expect(Number(rows[0]!.overlaps)).toBe(0);
    expect(await allocationCount(f.court.id)).toBeGreaterThan(0);
  });
});

describe("solapamientos y consecutivas", () => {
  it("rechaza una reserva parcialmente superpuesta (20:00-21:30 vs 21:00-22:00)", async () => {
    await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00"), 90, 1), publicActor, opts);
    await expectCode(
      createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "21:00"), 60, 2), publicActor, opts),
      "SLOT_UNAVAILABLE",
    );
    await expectCode(
      createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "19:00"), 120, 3), publicActor, opts),
      "SLOT_UNAVAILABLE",
    );
  });

  it("acepta reservas consecutivas que no se superponen (20:00-21:30 y 21:30-23:00)", async () => {
    const a = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00"), 90, 1), publicActor, opts);
    const b = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "21:30"), 90, 2), publicActor, opts);
    expect(a.booking.endsAt.getTime()).toBe(b.booking.startsAt.getTime());
  });

  it("la misma franja en otra cancha del mismo complejo es independiente", async () => {
    await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00"), 90, 1), publicActor, opts);
    const r = await createBooking(f.ctx, onlineInput(f.court2.id, at(DAY, "20:00"), 90, 2), publicActor, opts);
    expect(r.booking.courtId).toBe(f.court2.id);
  });

  it("reservas de distintos complejos en el mismo horario no interfieren", async () => {
    const g = await makeTenant("futbol-test");
    const a = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00"), 90, 1), publicActor, opts);
    const b = await createBooking(g.ctx, onlineInput(g.court.id, at(DAY, "20:00"), 90, 1), publicActor, opts);
    expect(a.booking.status).toBe("CONFIRMED");
    expect(b.booking.status).toBe("CONFIRMED");
  });
});

describe("turnos que cruzan medianoche", () => {
  it("permite 23:30 a 01:00 y bloquea el turno 00:30 que se solapa", async () => {
    const r = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "23:30"), 90, 1), publicActor, opts);
    expect(r.booking.endsAt.toISOString()).toBe(at("2030-03-06", "01:00").toISOString());
    // 00:30 del día siguiente pertenece al día operativo del martes.
    await expectCode(
      createBooking(f.ctx, onlineInput(f.court.id, at("2030-03-06", "00:30"), 60, 2), publicActor, opts),
      "SLOT_UNAVAILABLE",
    );
    const ok = await createBooking(f.ctx, onlineInput(f.court.id, at("2030-03-06", "01:00"), 60, 3), publicActor, opts);
    expect(ok.booking.status).toBe("CONFIRMED");
  });

  it("rechaza un turno que terminaría después del cierre (01:30 + 60 = 02:30 > 02:00)", async () => {
    await expectCode(
      createBooking(f.ctx, onlineInput(f.court.id, at("2030-03-06", "01:30"), 60, 1), publicActor, opts),
      "INVALID_SLOT",
    );
  });

  it("la disponibilidad del día incluye los turnos después de medianoche", async () => {
    const day = await getDayAvailability(f.ctx, { operatingDate: DAY, durationMinutes: 60 }, opts);
    const labels = day.courts[0]!.slots.map((s) => s.startsAt);
    expect(labels).toContain(at("2030-03-06", "01:00").toISOString());
    expect(labels).not.toContain(at("2030-03-06", "01:30").toISOString());
  });
});

describe("horarios inválidos", () => {
  it("rechaza horario fuera de la grilla (20:10)", async () => {
    await expectCode(
      createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:10"), 60, 1), publicActor, opts),
      "INVALID_SLOT",
    );
  });
  it("rechaza horario con el complejo cerrado (14:00)", async () => {
    await expectCode(
      createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "14:00"), 60, 1), publicActor, opts),
      "INVALID_SLOT",
    );
  });
  it("rechaza duración no permitida (45 min)", async () => {
    await expectCode(
      createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00"), 45, 1), publicActor, opts),
      "INVALID_DURATION",
    );
  });
  it("rechaza horarios en el pasado o dentro de la anticipación mínima", async () => {
    await expectCode(
      createBooking(f.ctx, onlineInput(f.court.id, at("2030-03-03", "20:00"), 60, 1), publicActor, opts),
      "SLOT_IN_PAST",
    );
    // Ahora = 09:00; turno 09:30 está dentro de la anticipación mínima de 60 min.
    await expectCode(
      createBooking(f.ctx, onlineInput(f.court.id, at("2030-03-04", "09:30"), 60, 2), publicActor, opts),
      "SLOT_IN_PAST",
    );
  });
  it("rechaza reservas más allá de la anticipación máxima (30 días)", async () => {
    await expectCode(
      createBooking(f.ctx, onlineInput(f.court.id, at("2030-04-20", "20:00"), 60, 1), publicActor, opts),
      "SLOT_TOO_FAR",
    );
  });
  it("una reserva manual sigue las mismas reglas de grilla y solapamiento", async () => {
    await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00"), 90, 1), publicActor, opts);
    const manual = { ...onlineInput(f.court.id, at(DAY, "20:30"), 60, 2), source: "MANUAL" as const };
    await expectCode(createBooking(f.ctx, manual, publicActor, opts), "SLOT_UNAVAILABLE");
    const offGrid = { ...onlineInput(f.court.id, at(DAY, "22:15"), 60, 3), source: "MANUAL" as const };
    await expectCode(createBooking(f.ctx, offGrid, publicActor, opts), "INVALID_SLOT");
  });
});

describe("solicitudes repetidas (idempotencia)", () => {
  it("la misma solicitud repetida devuelve la misma reserva sin duplicar", async () => {
    const input = onlineInput(f.court.id, at(DAY, "20:00"), 90, 1);
    const first = await createBooking(f.ctx, input, publicActor, opts);
    const second = await createBooking(f.ctx, input, publicActor, opts);
    expect(second.replayed).toBe(true);
    expect(second.booking.id).toBe(first.booking.id);
    expect(await owner.booking.count()).toBe(1);
  });

  it("10 envíos concurrentes de la misma solicitud generan una sola reserva", async () => {
    const input = onlineInput(f.court.id, at(DAY, "20:00"), 90, 1);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => createBooking(f.ctx, input, publicActor, opts)),
    );
    const ok = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<
      Awaited<ReturnType<typeof createBooking>>
    >[];
    expect(ok).toHaveLength(10);
    expect(new Set(ok.map((r) => r.value.booking.id)).size).toBe(1);
    expect(ok.filter((r) => !r.value.replayed)).toHaveLength(1);
    expect(await owner.booking.count()).toBe(1);
  });

  it("reusar la clave con otros datos se rechaza", async () => {
    const input = onlineInput(f.court.id, at(DAY, "20:00"), 90, 1);
    await createBooking(f.ctx, input, publicActor, opts);
    await expectCode(
      createBooking(f.ctx, { ...input, startsAt: at(DAY, "22:00") }, publicActor, opts),
      "IDEMPOTENCY_MISMATCH",
    );
  });
});

describe("estados, cancelación y reprogramación", () => {
  it("con aprobación requerida, la reserva online queda PENDING y ocupa el turno", async () => {
    const g = await makeTenant("aprobacion-test", { requiresApproval: true });
    const r = await createBooking(g.ctx, onlineInput(g.court.id, at(DAY, "20:00"), 90, 1), publicActor, opts);
    expect(r.booking.status).toBe("PENDING");
    await expectCode(
      createBooking(g.ctx, onlineInput(g.court.id, at(DAY, "20:30"), 60, 2), publicActor, opts),
      "SLOT_UNAVAILABLE",
    );
    const confirmed = await changeBookingStatus(
      g.ctx,
      { bookingId: r.booking.id, to: "CONFIRMED", expectedVersion: 1 },
      publicActor,
      opts,
    );
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.version).toBe(2);
  });

  it("cancelar libera el turno para otra persona", async () => {
    const r = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00"), 90, 1), publicActor, opts);
    await changeBookingStatus(
      f.ctx,
      { bookingId: r.booking.id, to: "CANCELLED", expectedVersion: 1, reason: "lluvia" },
      publicActor,
      opts,
    );
    expect(await allocationCount(f.court.id)).toBe(0);
    const again = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00"), 90, 2), publicActor, opts);
    expect(again.booking.status).toBe("CONFIRMED");
  });

  it("transiciones inválidas y versiones viejas se rechazan", async () => {
    const r = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00"), 90, 1), publicActor, opts);
    await changeBookingStatus(f.ctx, { bookingId: r.booking.id, to: "CANCELLED", expectedVersion: 1 }, publicActor, opts);
    await expectCode(
      changeBookingStatus(f.ctx, { bookingId: r.booking.id, to: "CONFIRMED", expectedVersion: 2 }, publicActor, opts),
      "BOOKING_CLOSED",
    );
    const other = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "22:00"), 60, 2), publicActor, opts);
    await expectCode(
      changeBookingStatus(f.ctx, { bookingId: other.booking.id, to: "REJECTED", expectedVersion: 1 }, publicActor, opts),
      "INVALID_TRANSITION",
    );
    await expectCode(
      changeBookingStatus(f.ctx, { bookingId: other.booking.id, to: "CANCELLED", expectedVersion: 7 }, publicActor, opts),
      "STALE_VERSION",
    );
  });

  it("dos cancelaciones simultáneas: solo una se aplica", async () => {
    const r = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00"), 90, 1), publicActor, opts);
    const results = await Promise.allSettled([
      changeBookingStatus(f.ctx, { bookingId: r.booking.id, to: "CANCELLED", expectedVersion: 1 }, publicActor, opts),
      changeBookingStatus(f.ctx, { bookingId: r.booking.id, to: "CANCELLED", expectedVersion: 1 }, publicActor, opts),
    ]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  });

  it("reprogramar a un horario libre mueve la ocupación", async () => {
    const r = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00"), 90, 1), publicActor, opts);
    const moved = await rescheduleBooking(
      f.ctx,
      { bookingId: r.booking.id, startsAt: at(DAY, "22:00"), durationMinutes: 90, expectedVersion: 1 },
      publicActor,
      opts,
    );
    expect(moved.startsAt.toISOString()).toBe(at(DAY, "22:00").toISOString());
    const alloc = await owner.courtAllocation.findUniqueOrThrow({ where: { bookingId: r.booking.id } });
    expect(alloc.startsAt.toISOString()).toBe(at(DAY, "22:00").toISOString());
    // El horario original quedó libre.
    await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00"), 60, 2), publicActor, opts);
  });

  it("reprogramar solapando consigo misma (correr 30 min) funciona", async () => {
    const r = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00"), 90, 1), publicActor, opts);
    const moved = await rescheduleBooking(
      f.ctx,
      { bookingId: r.booking.id, startsAt: at(DAY, "20:30"), durationMinutes: 90, expectedVersion: 1 },
      publicActor,
      opts,
    );
    expect(moved.version).toBe(2);
  });

  it("reprogramar sobre otra reserva falla y deja todo como estaba", async () => {
    const a = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00"), 90, 1), publicActor, opts);
    await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "22:00"), 90, 2), publicActor, opts);
    await expectCode(
      rescheduleBooking(
        f.ctx,
        { bookingId: a.booking.id, startsAt: at(DAY, "21:30"), durationMinutes: 90, expectedVersion: 1 },
        publicActor,
        opts,
      ),
      "SLOT_UNAVAILABLE",
    );
    const still = await owner.booking.findUniqueOrThrow({ where: { id: a.booking.id } });
    expect(still.startsAt.toISOString()).toBe(at(DAY, "20:00").toISOString());
    expect(still.version).toBe(1);
  });

  it("reprogramar a otra cancha del mismo complejo", async () => {
    const a = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00"), 90, 1), publicActor, opts);
    const moved = await rescheduleBooking(
      f.ctx,
      { bookingId: a.booking.id, startsAt: at(DAY, "20:00"), durationMinutes: 90, courtId: f.court2.id, expectedVersion: 1 },
      publicActor,
      opts,
    );
    expect(moved.courtId).toBe(f.court2.id);
    expect(await allocationCount(f.court.id)).toBe(0);
  });
});

describe("bloqueos de mantenimiento", () => {
  it("un bloqueo impide reservas en ese intervalo y al quitarlo se libera", async () => {
    const block = await createBlock(
      f.ctx,
      { courtId: f.court.id, startsAt: at(DAY, "19:00"), endsAt: at(DAY, "21:00"), reason: "Cambio de césped" },
      publicActor,
      opts,
    );
    await expectCode(
      createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:30"), 60, 1), publicActor, opts),
      "SLOT_UNAVAILABLE",
    );
    const manual = { ...onlineInput(f.court.id, at(DAY, "18:30"), 60, 2), source: "MANUAL" as const };
    await expectCode(createBooking(f.ctx, manual, publicActor, opts), "SLOT_UNAVAILABLE");
    // 21:00 justo al terminar el bloqueo: permitido.
    await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "21:00"), 60, 3), publicActor, opts);

    const day = await getDayAvailability(f.ctx, { operatingDate: DAY, durationMinutes: 60 }, opts);
    const slot1930 = day.courts[0]!.slots.find((s) => s.startsAt === at(DAY, "19:30").toISOString());
    expect(slot1930?.available).toBe(false);

    await deleteBlock(f.ctx, block.id, publicActor);
    await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "19:00"), 120, 4), publicActor, opts);
  });

  it("no se puede bloquear un intervalo con reservas activas", async () => {
    await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00"), 90, 1), publicActor, opts);
    await expectCode(
      createBlock(
        f.ctx,
        { courtId: f.court.id, startsAt: at(DAY, "21:00"), endsAt: at(DAY, "23:00"), reason: "Mantenimiento" },
        publicActor,
        opts,
      ),
      "BLOCK_CONFLICT",
    );
  });
});

describe("disponibilidad y precios", () => {
  it("marca ocupados los turnos tomados y aplica precio nocturno", async () => {
    await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00"), 90, 1), publicActor, opts);
    const day = await getDayAvailability(f.ctx, { operatingDate: DAY, durationMinutes: 90 }, opts);
    const slots = day.courts[0]!.slots;
    const s2000 = slots.find((s) => s.startsAt === at(DAY, "20:00").toISOString())!;
    const s2130 = slots.find((s) => s.startsAt === at(DAY, "21:30").toISOString())!;
    const s0800 = slots.find((s) => s.startsAt === at(DAY, "08:00").toISOString())!;
    expect(s2000.available).toBe(false);
    expect(s2130.available).toBe(true);
    expect(s2130.priceAmount).toBe(90 * 1500);
    expect(s0800.priceAmount).toBe(90 * 1000);
  });

  it("congela el precio en la reserva", async () => {
    const r = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "08:00"), 60, 1), publicActor, opts);
    expect(r.booking.priceAmount).toBe(60_000);
  });

  it("deja auditoría de la creación en la misma transacción", async () => {
    const r = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00"), 90, 1), publicActor, opts);
    const logs = await owner.auditLog.findMany({ where: { entityId: r.booking.id } });
    expect(logs.map((l) => l.action)).toEqual(["booking.created"]);
  });
});

void key;
