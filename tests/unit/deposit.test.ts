import { describe, expect, it } from "vitest";
import { depositFor } from "@/app/[slug]/BookingWidget";

describe("seña del resumen de reserva", () => {
  it("porcentaje, monto fijo (nunca mayor al precio) y sin seña", () => {
    expect(depositFor(22_000_00, { type: "PERCENT", value: 30, note: null })).toBe(6_600_00);
    expect(depositFor(22_000_00, { type: "FIXED", value: 5_000_00, note: null })).toBe(5_000_00);
    expect(depositFor(3_000_00, { type: "FIXED", value: 5_000_00, note: null })).toBe(3_000_00);
    expect(depositFor(22_000_00, { type: "NONE", value: 0, note: null })).toBeNull();
    expect(depositFor(null, { type: "PERCENT", value: 30, note: null })).toBeNull();
    expect(depositFor(22_000_00, undefined)).toBeNull();
  });
});
