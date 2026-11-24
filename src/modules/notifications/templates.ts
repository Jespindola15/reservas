/**
 * Plantillas de email con identidad TURNUP. HTML en tablas con estilos inline
 * (compatibilidad con clientes de correo) + versión de texto. TODO dato
 * variable pasa por `esc()`: nada de lo que escribe un jugador se interpreta como HTML.
 */

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type Row = [label: string, value: string];

export type EmailContent = { subject: string; html: string; text: string };

export function layout(opts: {
  preheader: string;
  title: string;
  intro: string;
  rows?: Row[];
  cta?: { label: string; url: string };
  note?: string;
  footer: string;
}): EmailContent & { subject: string } {
  const rows = (opts.rows ?? [])
    .map(
      ([l, v]) =>
        `<tr><td style="padding:6px 0;color:#9aa8c4;font-size:13px;width:38%;vertical-align:top">${esc(l)}</td><td style="padding:6px 0;color:#f3f6fb;font-size:14px;font-weight:600">${esc(v)}</td></tr>`,
    )
    .join("");
  const cta = opts.cta
    ? `<tr><td style="padding:22px 0 4px"><a href="${esc(opts.cta.url)}" style="display:inline-block;background:#c8f43b;color:#0a1004;text-decoration:none;font-weight:800;padding:12px 22px;border-radius:10px;font-size:15px">${esc(opts.cta.label)}</a></td></tr>`
    : "";
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>${esc(opts.title)}</title></head>
<body style="margin:0;padding:0;background:#05070d;font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(opts.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#05070d;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#0e1527;border:1px solid #22304f;border-radius:16px;overflow:hidden">
<tr><td style="padding:18px 24px;background:#0a0f1c;border-bottom:1px solid #22304f"><span style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;background:#c8f43b;color:#0a1004;border-radius:7px;font-weight:900">T</span> <span style="color:#f3f6fb;font-weight:900;letter-spacing:1px;font-size:16px;vertical-align:middle">TURN<span style="color:#c8f43b">UP</span></span></td></tr>
<tr><td style="padding:26px 24px 8px"><h1 style="margin:0 0 10px;color:#f3f6fb;font-size:22px;line-height:1.25">${esc(opts.title)}</h1><p style="margin:0;color:#c9d3e6;font-size:15px;line-height:1.55">${esc(opts.intro)}</p></td></tr>
<tr><td style="padding:8px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}${cta}</table></td></tr>
${opts.note ? `<tr><td style="padding:8px 24px 0"><p style="margin:0;color:#9aa8c4;font-size:13px;line-height:1.5">${esc(opts.note)}</p></td></tr>` : ""}
<tr><td style="padding:22px 24px;color:#6c7a98;font-size:12px;line-height:1.5;border-top:1px solid #22304f">${esc(opts.footer)}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    opts.title,
    "",
    opts.intro,
    "",
    ...(opts.rows ?? []).map(([l, v]) => `${l}: ${v}`),
    ...(opts.cta ? ["", `${opts.cta.label}: ${opts.cta.url}`] : []),
    ...(opts.note ? ["", opts.note] : []),
    "",
    "—",
    opts.footer,
  ].join("\n");
  return { subject: opts.title, html, text };
}
