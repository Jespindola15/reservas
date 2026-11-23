import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { findSlot, generateSlots, wallTimeToInstant, type ScheduleRule } from "@/modules/booking/time";
import { canTransition } from "@/modules/booking/service";
import { resolvePrice, type PriceRule } from "@/modules/booking/pricing";
import { customerContactKey, generateBookingCode } from "@/modules/booking/code";

const BA = "America/Argentina/Buenos_Aires";
const allDays = (open: number, close: number): ScheduleRule[] =>
  [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, openMinute: open, closeMinute: close }));

const local = (iso: string, tz = BA) => DateTime.fromISO(iso, { zone: tz }).toJSDate();

describe("generateSlots", () => {
  it("genera la grilla de 30 min y respeta el cierre según la duración", () => {
    const slots = generateSlots({ operatingDate: "2030-03-05", tz: BA, rules: allDays(1080, 1320), stepMinutes: 30, durationMinutes: 90 });
    const hhmm = slots.map((s) => DateTime.fromJSDate(s.startsAt, { zone: BA }).toFormat("HH:mm"));
    expect(hhmm).toEqual(["18:00", "18:30", "19:00", "19:30", "20:00", "20:30"]);
  });

  it("incluye turnos después de medianoche en el día operativo", () => {
    const slots = generateSlots({ operatingDate: "2030-03-05", tz: BA, rules: allDays(1320, 1560), stepMinutes: 60, durationMinutes: 60 });
    const iso = slots.map((s) => DateTime.fromJSDate(s.startsAt, { zone: BA }).toFormat("yyyy-MM-dd HH:mm"));
    expect(iso).toEqual(["2030-03-05 22:00", "2030-03-05 23:00", "2030-03-06 00:00", "2030-03-06 01:00"]);
    expect(slots[2]!.operatingDate).toBe("2030-03-05");
    expect(slots[2]!.localMinute).toBe(1440);
  });

  it("solo usa reglas del día de la semana correspondiente", () => {
    const rules: ScheduleRule[] = [{ weekday: 6, openMinute: 600, closeMinute: 720 }];
    expect(generateSlots({ operatingDate: "2030-03-05", tz: BA, rules, stepMinutes: 60, durationMinutes: 60 })).toEqual([]);
    expect(generateSlots({ operatingDate: "2030-03-09", tz: BA, rules, stepMinutes: 60, durationMinutes: 60 })).toHaveLength(2);
  });

  it("deduplica franjas superpuestas", () => {
    const rules: ScheduleRule[] = [
      { weekday: 2, openMinute: 600, closeMinute: 720 },
      { weekday: 2, openMinute: 660, closeMinute: 780 },
    ];
    const slots = generateSlots({ operatingDate: "2030-03-05", tz: BA, rules, stepMinutes: 60, durationMinutes: 60 });
    expect(slots).toHaveLength(3);
  });

  it("fecha inválida no genera turnos", () => {
    expect(generateSlots({ operatingDate: "2030-02-30", tz: BA, rules: allDays(0, 600), stepMinutes: 60, durationMinutes: 60 })).toEqual([]);
  });
});

describe("findSlot", () => {
  const rules = allDays(1080, 1560);
  it("encuentra un turno pasada la medianoche en el día operativo anterior", () => {
    const s = findSlot({ startsAt: local("2030-03-06T00:30"), durationMinutes: 60, tz: BA, rules, stepMinutes: 30 });
    expect(s?.operatingDate).toBe("2030-03-05");
  });
  it("rechaza fuera de grilla, fuera de horario y pasado el cierre", () => {
    expect(findSlot({ startsAt: local("2030-03-05T20:10"), durationMinutes: 60, tz: BA, rules, stepMinutes: 30 })).toBeNull();
    expect(findSlot({ startsAt: local("2030-03-05T15:00"), durationMinutes: 60, tz: BA, rules, stepMinutes: 30 })).toBeNull();
    expect(findSlot({ startsAt: local("2030-03-06T01:30"), durationMinutes: 60, tz: BA, rules, stepMinutes: 30 })).toBeNull();
  });
});

describe("zonas horarias con horario de verano (Europe/Madrid)", () => {
  const MAD = "Europe/Madrid";
  it("no genera turnos en la hora inexistente del cambio (02:00-03:00 del 31/3/2030)", () => {
    const slots = generateSlots({ operatingDate: "2030-03-31", tz: MAD, rules: allDays(60, 300), stepMinutes: 30, durationMinutes: 60 });
    const hhmm = slots.map((s) => DateTime.fromJSDate(s.startsAt, { zone: MAD }).toFormat("HH:mm"));
    expect(hhmm).not.toContain("02:00");
    expect(hhmm).not.toContain("02:30");
    expect(wallTimeToInstant("2030-03-31", 150, MAD)).toBeNull();
  });
  it("la duración es tiempo real: 90 min reales aunque cambie la hora", () => {
    const slots = generateSlots({ operatingDate: "2030-03-31", tz: MAD, rules: allDays(60, 300), stepMinutes: 30, durationMinutes: 90 });
    for (const s of slots) expect(s.endsAt.getTime() - s.startsAt.getTime()).toBe(90 * 60_000);
  });
});

describe("precios", () => {
  const rules: PriceRule[] = [
    { durationMinutes: 60, weekday: null, startMinute: null, endMinute: null, amount: 1000 },
    { durationMinutes: 60, weekday: 6, startMinute: null, endMinute: null, amount: 1200 },
    { durationMinutes: 60, weekday: null, startMinute: 1080, endMinute: 1560, amount: 1500 },
    { durationMinutes: 60, weekday: 6, startMinute: 1080, endMinute: 1560, amount: 1800 },
  ];
  it("elige la regla más específica", () => {
    expect(resolvePrice(rules, { durationMinutes: 60, weekday: 2, localMinute: 600 })).toBe(1000);
    expect(resolvePrice(rules, { durationMinutes: 60, weekday: 6, localMinute: 600 })).toBe(1200);
    expect(resolvePrice(rules, { durationMinutes: 60, weekday: 2, localMinute: 1200 })).toBe(1500);
    expect(resolvePrice(rules, { durationMinutes: 60, weekday: 6, localMinute: 1500 })).toBe(1800);
  });
  it("sin regla para la duración devuelve null (a confirmar)", () => {
    expect(resolvePrice(rules, { durationMinutes: 90, weekday: 2, localMinute: 600 })).toBeNull();
  });
});

describe("estados y utilidades", () => {
  it("define transiciones explícitas", () => {
    expect(canTransition("PENDING", "CONFIRMED")).toBe(true);
    expect(canTransition("CONFIRMED", "PENDING")).toBe(false);
    expect(canTransition("CANCELLED", "CONFIRMED")).toBe(false);
    expect(canTransition("CONFIRMED", "CANCELLED")).toBe(true);
  });
  it("códigos de reserva legibles y sin caracteres ambiguos", () => {
    for (let i = 0; i < 200; i++) expect(generateBookingCode()).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  });
  it("normaliza la clave de cliente", () => {
    expect(customerContactKey(" Ana@Mail.COM ", "11 2222")).toBe("ana@mail.com");
    expect(customerContactKey(null, "+54 (11) 5555-1234")).toBe("tel:541155551234");
  });
});
