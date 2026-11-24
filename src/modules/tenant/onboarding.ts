import { z } from "zod";
import { audit, type Actor } from "@/lib/audit";
import { withTenant, type TenantContext } from "@/lib/db/tenant-context";
import { parseOrThrow } from "@/lib/validation";

/**
 * Asistente de puesta en marcha (7 pasos). El avance se calcula con los datos
 * reales del complejo, así se puede retomar en cualquier momento y desde
 * cualquier dispositivo; solo los pasos "de revisión" guardan una marca.
 */
export const ONBOARDING_STEPS = [
  { n: 1, key: "datos", title: "Datos del complejo", hint: "Nombre, dirección, teléfono y una descripción corta.", href: "ajustes" },
  { n: 2, key: "marca", title: "Logo y página", hint: "Subí tu logo, una portada y elegí tu color.", href: "pagina" },
  { n: 3, key: "canchas", title: "Canchas", hint: "Cargá al menos una cancha activa.", href: "canchas" },
  { n: 4, key: "horarios", title: "Horarios", hint: "Definí los días y horas de apertura de cada cancha.", href: "canchas" },
  { n: 5, key: "precios", title: "Precios", hint: "Tarifas por duración y franja horaria.", href: "canchas" },
  { n: 6, key: "reglas", title: "Reglas de reserva", hint: "Anticipación, cancelación online y aprobación manual.", href: "ajustes" },
  { n: 7, key: "publicar", title: "Publicar", hint: "Compartí tu enlace y el QR con tus clientes.", href: "pagina" },
] as const;

export async function getOnboarding(ctx: TenantContext) {
  return withTenant(ctx, async (tx) => {
    const t = await tx.tenant.findUniqueOrThrow({
      where: { id: ctx.tenantId },
      select: { slug: true, name: true, address: true, contactPhone: true, description: true, onboardingStep: true, onboardingCompletedAt: true },
    });
    const [logo, courts, rules, prices] = await Promise.all([
      tx.tenantAsset.count({ where: { tenantId: ctx.tenantId, kind: "LOGO" } }),
      tx.court.count({ where: { tenantId: ctx.tenantId, isActive: true } }),
      tx.courtScheduleRule.count({ where: { tenantId: ctx.tenantId } }),
      tx.courtPriceRule.count({ where: { tenantId: ctx.tenantId } }),
    ]);
    const done: Record<number, boolean> = {
      1: Boolean(t.address && t.contactPhone && t.description),
      2: logo > 0 || t.onboardingStep >= 2,
      3: courts > 0,
      4: rules > 0,
      5: prices > 0,
      6: t.onboardingStep >= 6,
      7: Boolean(t.onboardingCompletedAt),
    };
    const steps = ONBOARDING_STEPS.map((s) => ({ ...s, done: done[s.n]! }));
    const completed = steps.filter((s) => s.done).length;
    const current = steps.find((s) => !s.done)?.n ?? 7;
    return { tenant: t, steps, completed, current, finished: Boolean(t.onboardingCompletedAt) };
  });
}

/** Marca un paso de revisión (2 = marca omitida, 6 = reglas revisadas) o termina (7). */
export async function markOnboardingStep(ctx: TenantContext, step: number, actor: Actor) {
  const n = parseOrThrow(z.union([z.literal(2), z.literal(6), z.literal(7)]), step);
  await withTenant(ctx, async (tx) => {
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { onboardingStep: true } });
    await tx.tenant.update({
      where: { id: ctx.tenantId },
      data: { onboardingStep: Math.max(t.onboardingStep, n), ...(n === 7 ? { onboardingCompletedAt: new Date() } : {}) },
    });
    await audit(tx, { tenantId: ctx.tenantId, actor, action: "tenant.onboarding.step", entityType: "tenant", entityId: ctx.tenantId, metadata: { step: n } });
  });
}
