import { describe, expect, it } from "vitest";
import { computeStats, delta, resolveRange } from "@/modules/dashboard/stats";

const TZ = "America/Argentina/Buenos_Aires";
const NOW = new Date("2030-03-04T12:00:00Z");

describe("resolveRange", () => {
  it("mes, semana y día con período anterior equivalente", () => {
    expect(resolveRange({ period: "month", date: "2030-03-15" }, TZ, NOW).current).toEqual({ from: "2030-03-01", to: "2030-03-31", days: 31 });
    expect(resolveRange({ period: "month", date: "2030-03-15" }, TZ, NOW).previous).toEqual({ from: "2030-01-29", to: "2030-02-28", days: 31 });
    const w = resolveRange({ period: "week", date: "2030-03-06" }, TZ, NOW);
    expect(w.current).toEqual({ from: "2030-03-04", to: "2030-03-10", days: 7 });
    expect(w.previous.from).toBe("2030-02-25");
    expect(resolveRange({ period: "day" }, TZ, NOW).current).toEqual({ from: "2030-03-04", to: "2030-03-04", days: 1 });
  });
  it("rango personalizado inválido o demasiado largo no rompe la página", () => {
    const bad = resolveRange({ period: "custom", from: "2030-03-10", to: "2030-03-01" }, TZ, NOW);
    expect(bad.error).toMatch(/rango/);
    expect(bad.current.days).toBe(1);
    const long = resolveRange({ period: "custom", from: "2030-01-01", to: "2030-12-31" }, TZ, NOW);
    expect(long.current.days).toBe(92);
    expect(long.error).toMatch(/92/);
    expect(resolveRange({ period: "hack'; drop" }, TZ, NOW).period).toBe("month");
  });
});

describe("computeStats", () => {
  const b = (id: string, status: string, hourUtc: number, price: number | null, customerId = "c1", courtId = "k1") => ({
    id, status, courtId, customerId, startsAt: new Date(`2030-03-05T${String(hourUtc).padStart(2, "0")}:00:00Z`), durationMinutes: 60, priceAmount: price,
  });
  it("cobrado, proyectado, pendiente, ocupación, cancelaciones y picos", () => {
    const s = computeStats({
      tz: TZ,
      bookings: [b("a", "CONFIRMED", 23, 10_000), b("b", "COMPLETED", 23, 8_000, "c2"), b("c", "CANCELLED", 21, 10_000), b("d", "PENDING", 22, null, "c3"), b("e", "EXPIRED", 20, 5_000)],
      paymentsInRange: [{ bookingId: "a", kind: "DEPOSIT", amount: 4_000, paidAt: NOW }, { bookingId: "a", kind: "REFUND", amount: 1_000, paidAt: NOW }],
      paymentsOfBookings: [{ bookingId: "a", kind: "DEPOSIT", amount: 4_000, paidAt: NOW }, { bookingId: "a", kind: "REFUND", amount: 1_000, paidAt: NOW }, { bookingId: "b", kind: "PAYMENT", amount: 9_000, paidAt: NOW }],
      courts: [{ id: "k1", name: "Cancha 1", openMinutes: 600 }],
      firstBookingAt: new Map([["c1", new Date("2029-01-01")], ["c2", new Date("2030-03-05")]]),
      rangeStart: new Date("2030-03-01T03:00:00Z"),
    });
    expect(s.money).toEqual({ collected: 3_000, projected: 18_000, pendingCollection: 7_000 });
    expect(s.bookings).toMatchObject({ total: 5, active: 3, cancelled: 1, withoutPrice: 1 });
    expect(s.occupancy).toEqual({ openMinutes: 600, bookedMinutes: 180, pct: 30 });
    expect(s.cancellationRate).toBe(25); // 1 de 4 (las vencidas no cuentan)
    expect(s.customers).toEqual({ total: 3, new: 2, returning: 1 });
    expect(s.byHour[20]).toBe(2); // 23 UTC = 20 h local
    expect(s.byWeekday[1]).toBe(3); // martes
  });
  it("sin datos devuelve ceros, no inventa", () => {
    const s = computeStats({ tz: TZ, bookings: [], paymentsInRange: [], paymentsOfBookings: [], courts: [], firstBookingAt: new Map(), rangeStart: NOW });
    expect(s.money).toEqual({ collected: 0, projected: 0, pendingCollection: 0 });
    expect(s.occupancy.pct).toBeNull();
    expect(s.cancellationRate).toBe(0);
  });
  it("delta", () => {
    expect(delta(150, 100)).toBe(50);
    expect(delta(5, 0)).toBeNull();
  });
});
