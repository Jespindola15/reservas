import { describe, expect, it, vi } from "vitest";
import { logger, redact } from "@/lib/logger";
import { esc, layout } from "@/modules/notifications/templates";
import { csvCell } from "@/modules/exports/csv";

describe("logs sin secretos ni datos personales", () => {
  it("redacta credenciales en URLs, Bearer, token= y emails", () => {
    const out = redact("db postgresql://app:Sup3r@db.host:5432/x Bearer abc.def token=XYZ123 de juan@example.com");
    expect(out).not.toMatch(/Sup3r|abc\.def|XYZ123|juan@example\.com/);
    expect(out).toContain("postgresql://<redacted>@db.host");
  });
  it("el logger aplica la redacción y oculta campos sensibles por nombre", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info("x", { password: "hunter2", sessionToken: "t", email: "a@b.co", ok: 1 });
    const line = String(spy.mock.calls[0]![0]);
    spy.mockRestore();
    expect(line).not.toMatch(/hunter2|a@b\.co|"sessionToken":"t"/);
    expect(line).toContain('"ok":1');
  });
});

describe("plantillas de email", () => {
  it("escapan HTML de datos ingresados por usuarios", () => {
    expect(esc('<img src=x onerror="a">')).toBe("&lt;img src=x onerror=&quot;a&quot;&gt;");
    const mail = layout({ preheader: "p", title: "Hola <b>x</b>", intro: "i", rows: [["Nombre", "<script>"]], footer: "f" });
    expect(mail.html).not.toContain("<script>");
    expect(mail.text).toContain("Nombre");
  });
  it("CSV neutraliza fórmulas", () => expect(csvCell("-1+2")).toBe(`"'-1+2"`));
});
