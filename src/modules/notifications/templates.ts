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

export type EmailContent = { subject: string; html: string; text: string; replyTo?: string | null };

/** Colores de la identidad TURNUP (negro, blanco y verde lima). */
const C = { black: "#09090b", ink: "#111114", text: "#18181b", muted: "#52525b", faint: "#71717a", line: "#e4e4e7", soft: "#f4f4f5", page: "#ececee", lime: "#a0f802", limeInk: "#0a1004" };

const TONES = {
  ok: { bg: "#ecfccb", fg: "#3f6212" },
  warn: { bg: "#fef3c7", fg: "#92400e" },
  bad: { bg: "#fee2e2", fg: "#991b1b" },
  info: { bg: C.soft, fg: C.text },
} as const;
export type Tone = keyof typeof TONES;

/**
 * Encabezado con el logo (PNG publicado en el sitio; los clientes de correo no muestran SVG).
 * Sin URL pública https queda el nombre en texto.
 */
function brandHeader(): string {
  const base = process.env.BETTER_AUTH_URL ?? "";
  if (/^https:\/\//.test(base)) {
    return `<img src="${esc(base.replace(/\/$/, ""))}/brand/turnup-email.png" width="138" height="32" alt="TURNUP" style="display:block;border:0;outline:none;height:32px;width:138px">`;
  }
  return `<span style="color:#ffffff;font-weight:900;letter-spacing:0.5px;font-size:20px;font-family:Arial,Helvetica,sans-serif"><span style="color:${C.lime}">t</span>urnup</span>`;
}

/** Botón "a prueba de Outlook" (VML) con el verde de la marca. */
function button(label: string, url: string, primary = true): string {
  const bg = primary ? C.lime : "#ffffff";
  const fg = primary ? C.limeInk : C.text;
  const border = primary ? C.lime : C.line;
  return `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${esc(url)}" style="height:46px;v-text-anchor:middle;width:280px" arcsize="22%" stroke="t" strokecolor="${border}" fillcolor="${bg}"><center style="color:${fg};font-family:Arial,sans-serif;font-size:15px;font-weight:bold">${esc(label)}</center></v:roundrect><![endif]--><!--[if !mso]><!--><a href="${esc(url)}" style="display:inline-block;background:${bg};color:${fg};border:1px solid ${border};text-decoration:none;font-weight:800;padding:13px 24px;border-radius:10px;font-size:15px;line-height:20px;font-family:Arial,Helvetica,sans-serif;mso-hide:all">${esc(label)}</a><!--<![endif]-->`;
}

export function layout(opts: {
  preheader: string;
  title: string;
  intro: string;
  /** Estado destacado (p. ej. "Confirmada", "Pendiente de pago"). */
  badge?: { label: string; tone: Tone };
  rows?: Row[];
  cta?: { label: string; url: string };
  secondaryCta?: { label: string; url: string };
  note?: string;
  /** Datos de contacto (p. ej. del complejo). */
  contact?: string;
  footer: string;
  subject?: string;
  replyTo?: string | null;
}): EmailContent {
  const font = "font-family:Arial,Helvetica,sans-serif";
  const rows = (opts.rows ?? [])
    .map(
      ([l, v], i) =>
        `<tr><td style="padding:10px 14px;${i ? `border-top:1px solid ${C.line};` : ""}color:${C.faint};font-size:13px;width:40%;vertical-align:top;${font}">${esc(l)}</td><td style="padding:10px 14px;${i ? `border-top:1px solid ${C.line};` : ""}color:${C.text};font-size:14px;font-weight:bold;${font}">${esc(v)}</td></tr>`,
    )
    .join("");
  const badge = opts.badge
    ? `<tr><td style="padding:0 28px 6px"><span style="display:inline-block;background:${TONES[opts.badge.tone].bg};color:${TONES[opts.badge.tone].fg};font-size:12px;font-weight:bold;letter-spacing:0.3px;text-transform:uppercase;padding:5px 10px;border-radius:999px;${font}">${esc(opts.badge.label)}</span></td></tr>`
    : "";
  const ctas = [opts.cta ? button(opts.cta.label, opts.cta.url) : "", opts.secondaryCta ? button(opts.secondaryCta.label, opts.secondaryCta.url, false) : ""].filter(Boolean);
  const html = `<!doctype html><html lang="es" xmlns:v="urn:schemas-microsoft-com:vml"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(opts.title)}</title>
<style>@media (max-width:600px){.card{border-radius:0!important}.px{padding-left:18px!important;padding-right:18px!important}h1{font-size:21px!important}}</style></head>
<body style="margin:0;padding:0;background:${C.page};-webkit-text-size-adjust:100%">
<span style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all">${esc(opts.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page}"><tr><td align="center" style="padding:24px 8px">
<table role="presentation" class="card" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td class="px" style="padding:18px 28px;background:${C.black}">${brandHeader()}</td></tr>
<tr><td style="height:4px;line-height:4px;font-size:0;background:${C.lime}">&nbsp;</td></tr>
<tr><td class="px" style="padding:28px 28px 10px"><h1 style="margin:0 0 10px;color:${C.text};font-size:24px;line-height:1.25;${font}">${esc(opts.title)}</h1><p style="margin:0;color:${C.muted};font-size:15px;line-height:1.6;${font}">${esc(opts.intro)}</p></td></tr>
${badge}
${rows ? `<tr><td class="px" style="padding:10px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.soft};border-radius:10px">${rows}</table></td></tr>` : ""}
${ctas.length ? `<tr><td class="px" style="padding:18px 28px 6px">${ctas.join('<div style="height:10px;line-height:10px">&nbsp;</div>')}</td></tr>` : ""}
${opts.note ? `<tr><td class="px" style="padding:12px 28px 0"><p style="margin:0;color:${C.muted};font-size:13px;line-height:1.55;${font}">${esc(opts.note)}</p></td></tr>` : ""}
${opts.contact ? `<tr><td class="px" style="padding:14px 28px 0"><p style="margin:0;color:${C.text};font-size:13px;line-height:1.55;${font}"><strong>Contacto:</strong> ${esc(opts.contact)}</p></td></tr>` : ""}
<tr><td class="px" style="padding:24px 28px;color:${C.faint};font-size:12px;line-height:1.55;${font}">${esc(opts.footer)}</td></tr>
</table>
<p style="margin:14px 0 0;color:${C.faint};font-size:11px;${font}">TURNUP · Reservas de canchas</p>
</td></tr></table></body></html>`;
  const text = [
    opts.title,
    "",
    opts.intro,
    ...(opts.badge ? ["", `Estado: ${opts.badge.label}`] : []),
    "",
    ...(opts.rows ?? []).map(([l, v]) => `${l}: ${v}`),
    ...(opts.cta ? ["", `${opts.cta.label}: ${opts.cta.url}`] : []),
    ...(opts.secondaryCta ? [`${opts.secondaryCta.label}: ${opts.secondaryCta.url}`] : []),
    ...(opts.note ? ["", opts.note] : []),
    ...(opts.contact ? ["", `Contacto: ${opts.contact}`] : []),
    "",
    "—",
    opts.footer,
  ].join("\n");
  return { subject: opts.subject ?? opts.title, html, text, replyTo: opts.replyTo ?? null };
}
