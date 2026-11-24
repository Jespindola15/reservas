import { describe, expect, it } from "vitest";
import { whatsappLink, whatsappNumber } from "@/lib/contact/whatsapp";

describe("WhatsApp", () => {
  it.each([
    ["11 5555-1234", "5491155551234"],
    ["011 15 5555-1234", "5491155551234"],
    ["(0351) 15 412-3456", "5493514123456"],
    ["+54 9 11 5555-1234", "5491155551234"],
    ["2615123456", "5492615123456"],
  ])("%s -> %s", (raw, expected) => expect(whatsappNumber(raw)).toBe(expected));
  it("descarta números imposibles", () => {
    expect(whatsappNumber("123")).toBeNull();
    expect(whatsappNumber("")).toBeNull();
  });
  it("arma el enlace con texto codificado, sin enviar nada", () => {
    expect(whatsappLink("11 5555-1234", "Hola & chau")).toBe("https://wa.me/5491155551234?text=Hola%20%26%20chau");
  });
});
