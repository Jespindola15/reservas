import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { owner, resetDb } from "../support/fixtures";

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
  await owner.$disconnect();
});

describe("rate limiting persistente", () => {
  it("permite hasta el máximo y luego bloquea con retryAfter", async () => {
    const rule = { window: 60, max: 3 };
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await consumeRateLimit("t:secuencial", rule));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false, false]);
    expect(results[4]!.retryAfter).toBeGreaterThan(0);
  });

  it("es atómico ante 50 solicitudes simultáneas (no se cuelan más del máximo)", async () => {
    const rule = { window: 60, max: 5 };
    const results = await Promise.all(Array.from({ length: 50 }, () => consumeRateLimit("t:concurrente", rule)));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });

  it("se reinicia al vencer la ventana", async () => {
    const rule = { window: 1, max: 1 };
    expect((await consumeRateLimit("t:ventana", rule)).allowed).toBe(true);
    expect((await consumeRateLimit("t:ventana", rule)).allowed).toBe(false);
    await owner.$executeRaw`UPDATE rate_limits SET window_start = now() - interval '5 seconds' WHERE key = 't:ventana'`;
    expect((await consumeRateLimit("t:ventana", rule)).allowed).toBe(true);
  });
});
