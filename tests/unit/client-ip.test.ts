import { afterEach, describe, expect, it, vi } from "vitest";

async function ipWith(env: Record<string, string>, headers: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries({ DATABASE_URL: "postgresql://a:b@localhost/x", BETTER_AUTH_SECRET: "x".repeat(40), BETTER_AUTH_URL: "http://localhost:3000", ...env })) vi.stubEnv(k, v);
  const { getClientIp } = await import("@/lib/security/client-ip");
  return getClientIp(new Headers(headers));
}

afterEach(() => vi.unstubAllEnvs());

describe("IP del cliente (fuente única)", () => {
  it("sin proxy configurado ignora cabeceras falsificables", async () => {
    expect(await ipWith({ AUTH_CLIENT_IP_HEADER: "", TRUST_PROXY_HOPS: "0" }, { "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8" })).toBe("unknown");
  });
  it("usa la cabecera que sobrescribe el proxy", async () => {
    expect(await ipWith({ AUTH_CLIENT_IP_HEADER: "x-real-ip" }, { "x-real-ip": "5.6.7.8", "x-forwarded-for": "1.1.1.1" })).toBe("5.6.7.8");
    expect(await ipWith({ AUTH_CLIENT_IP_HEADER: "x-real-ip" }, { "x-real-ip": "<script>" })).toBe("unknown");
  });
  it("con N proxies toma la N-ésima desde el final de X-Forwarded-For", async () => {
    expect(await ipWith({ AUTH_CLIENT_IP_HEADER: "", TRUST_PROXY_HOPS: "1" }, { "x-forwarded-for": "6.6.6.6, 9.9.9.9" })).toBe("9.9.9.9");
  });
});
