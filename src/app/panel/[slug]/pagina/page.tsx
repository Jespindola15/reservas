import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { ActionForm } from "@/components/ActionForm";
import ui from "@/components/ui.module.css";
import { requireTenantPage } from "@/lib/auth/page";
import { publicTenantUrl } from "@/lib/public-url";
import { MAX_GALLERY, SERVICE_OPTIONS, getBranding } from "@/modules/tenant/branding";
import { deleteTenantAssetAction, updateBrandingAction, uploadTenantAssetAction } from "../config-actions";
import { CopyLink } from "./CopyLink";

export const metadata: Metadata = { title: "Página pública" };

export default async function PublicPageSettings({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = await requireTenantPage(slug, "tenant.settings");
  if (!access) notFound();
  const b = await getBranding(access.ctx);
  const url = publicTenantUrl(b.slug);
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 240, color: { dark: "#0b0f0a", light: "#ffffff" } });
  const img = (id: string) => `/api/public/${b.slug}/assets/${id}`;
  const logo = b.assets.find((a) => a.kind === "LOGO");
  const cover = b.assets.find((a) => a.kind === "COVER");
  const gallery = b.assets.filter((a) => a.kind === "GALLERY");

  const upload = (kind: "LOGO" | "COVER" | "GALLERY", label: string, hint: string) => (
    <ActionForm action={uploadTenantAssetAction.bind(null, slug, kind)} submitLabel={label} pendingLabel="Subiendo…" variant="secondary" className={ui.stack} resetOnSuccess>
      <label className={ui.field}>
        <span className="sr-only">Archivo de imagen ({label.toLowerCase()})</span>
        <input className={ui.input} type="file" name="image" accept="image/jpeg,image/png,image/webp" required />
        <span className={ui.hint}>{hint}</span>
      </label>
    </ActionForm>
  );
  const remove = (id: string, label: string) => (
    <ActionForm action={deleteTenantAssetAction.bind(null, slug)} submitLabel="Quitar" ariaLabel={`Quitar ${label}`} variant="ghost" small quietSuccess>
      <input type="hidden" name="assetId" value={id} />
    </ActionForm>
  );

  return (
    <>
      <header className={ui.pageHeader}>
        <div>
          <p className={ui.eyebrow}>Configuración</p>
          <h1>Página pública</h1>
        </div>
        <Link href={`/${b.slug}`} target="_blank" rel="noopener" className={`${ui.button} ${ui.buttonSecondary}`}>Ver página</Link>
      </header>

      <div className={ui.grid2} style={{ marginBottom: "1rem", alignItems: "start" }}>
        <section className={ui.card} aria-labelledby="enlace">
          <div className={ui.cardHeader}><h2 id="enlace">Enlace y QR</h2></div>
          <p><code>{url}</code></p>
          <CopyLink url={url} title={`Reservá en ${b.name}`} />
          <div className={ui.row} style={{ marginTop: "1rem", alignItems: "flex-start" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt={`Código QR de ${url}`} width={160} height={160} style={{ borderRadius: 8, background: "#fff" }} />
            <div className={ui.stackSm}>
              <a className={ui.button} href={`/panel/${slug}/qr?formato=png`} download>Descargar QR (PNG)</a>
              <a className={`${ui.button} ${ui.buttonSecondary}`} href={`/panel/${slug}/qr?formato=svg`} download>Descargar QR (SVG)</a>
              <span className={ui.hint}>Imprimilo en el mostrador o en las canchas.</span>
            </div>
          </div>
        </section>

        <section className={ui.card} aria-labelledby="imagenes">
          <div className={ui.cardHeader}><h2 id="imagenes">Logo y portada</h2></div>
          <div className={ui.stack}>
            <div>
              <strong>Logo</strong>
              {logo ? (
                <div className={ui.row} style={{ margin: "0.5rem 0" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img(logo.id)} alt="Logo actual" width={64} height={64} style={{ borderRadius: 12 }} />
                  {remove(logo.id, "logo")}
                </div>
              ) : null}
              {upload("LOGO", "Subir logo", "Se recorta en cuadrado (512 px) y se optimiza. JPG, PNG o WebP de hasta 1,5 MB.")}
            </div>
            <div>
              <strong>Portada</strong>
              {cover ? (
                <div className={ui.stackSm} style={{ margin: "0.5rem 0" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img(cover.id)} alt="Portada actual" style={{ width: "100%", aspectRatio: "8 / 3", objectFit: "cover", borderRadius: 12 }} />
                  {remove(cover.id, "portada")}
                </div>
              ) : null}
              {upload("COVER", "Subir portada", "Se recorta a 1600 × 600 px enfocando lo importante.")}
            </div>
          </div>
        </section>
      </div>

      <section className={ui.card} aria-labelledby="galeria" style={{ marginBottom: "1rem" }}>
        <div className={ui.cardHeader}><h2 id="galeria">Galería</h2><span className={ui.muted}>{gallery.length} de {MAX_GALLERY}</span></div>
        {gallery.length ? (
          <div className={ui.row} style={{ marginBottom: "0.75rem" }}>
            {gallery.map((g, i) => (
              <div key={g.id} className={ui.stackSm}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img(g.id)} alt={`Foto ${i + 1} de la galería`} width={140} height={100} style={{ objectFit: "cover", borderRadius: 10 }} />
                {remove(g.id, `foto ${i + 1}`)}
              </div>
            ))}
          </div>
        ) : <p className={ui.muted}>Todavía no hay fotos.</p>}
        {gallery.length < MAX_GALLERY ? upload("GALLERY", "Agregar foto", "Se optimiza automáticamente (máx. 1600 px).") : null}
      </section>

      <ActionForm action={updateBrandingAction.bind(null, slug)} submitLabel="Guardar página pública" className={ui.stack}>
        <section className={ui.card}>
          <div className={ui.cardHeader}><h2>Marca y contacto</h2></div>
          <div className={ui.grid2}>
            <label className={ui.field}>
              <span className={ui.label}>Color de marca</span>
              <input className={ui.input} type="color" name="brandColor" defaultValue={b.brandColor ?? "#a0f802"} style={{ height: 44, padding: 4 }} />
              <span className={ui.hint}>Se usa en botones y destacados de tu página.</span>
            </label>
            <label className={ui.field}><span className={ui.label}>WhatsApp</span><input className={ui.input} name="whatsapp" maxLength={30} defaultValue={b.whatsapp ?? ""} placeholder="11 5555-0000" /></label>
            <label className={ui.field}><span className={ui.label}>Instagram</span><input className={ui.input} name="instagram" maxLength={80} defaultValue={b.instagram ?? ""} placeholder="@tucomplejo" /></label>
            <label className={ui.field}><span className={ui.label}>Facebook</span><input className={ui.input} name="facebook" maxLength={80} defaultValue={b.facebook ?? ""} placeholder="tucomplejo" /></label>
            <label className={ui.field}><span className={ui.label}>Sitio web</span><input className={ui.input} type="url" name="website" maxLength={200} defaultValue={b.website ?? ""} placeholder="https://" /></label>
          </div>
        </section>
        <section className={ui.card}>
          <div className={ui.cardHeader}><h2>Servicios</h2></div>
          <div className={ui.grid3}>
            {SERVICE_OPTIONS.map((s) => (
              <label key={s} className={ui.checkbox}><input type="checkbox" name="services" value={s} defaultChecked={b.services.includes(s)} />{s}</label>
            ))}
          </div>
        </section>
        <section className={ui.card}>
          <div className={ui.cardHeader}><h2>Política de cancelación</h2></div>
          <label className={ui.field}>
            <span className="sr-only">Política de cancelación</span>
            <textarea className={ui.textarea} name="cancellationPolicy" maxLength={1000} defaultValue={b.cancellationPolicy ?? ""} placeholder="Ej.: Podés cancelar sin cargo hasta 2 horas antes. Las señas no se devuelven si no avisás." />
            <span className={ui.hint}>Se muestra antes de confirmar la reserva. El límite para cancelar online se configura en Ajustes.</span>
          </label>
        </section>
        <section className={ui.card}>
          <label className={ui.checkbox}>
            <input type="checkbox" name="publicListed" defaultChecked={b.publicListed} />
            Mostrar mi complejo en el listado de la portada de TURNUP
          </label>
        </section>
      </ActionForm>
    </>
  );
}
