import { z } from "zod";
import { audit, type Actor } from "@/lib/audit";
import { withTenant, type TenantContext } from "@/lib/db/tenant-context";
import { parseOrThrow } from "@/lib/validation";

/** Ajustes que el propio complejo puede cambiar. Límites seguros = los mismos CHECK de la BD. */
export const tenantSettingsSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(600).optional().transform((v) => v || null),
  contactPhone: z.string().trim().max(30).regex(/^[0-9+()\s.-]*$/).optional().transform((v) => v || null),
  contactEmail: z.union([z.literal(""), z.email().max(254)]).optional().transform((v) => v || null),
  address: z.string().trim().max(200).optional().transform((v) => v || null),
  bookingRequiresApproval: z.boolean(),
  minLeadMinutes: z.number().int().min(0).max(10080),
  maxAdvanceDays: z.number().int().min(1).max(365),
  pendingExpirationMinutes: z.number().int().min(5).max(1440),
  publicCancellationMinutes: z.number().int().min(0).max(10080),
});
export type TenantSettingsInput = z.input<typeof tenantSettingsSchema>;

export async function getTenantSettings(ctx: TenantContext) {
  return withTenant(ctx, (tx) =>
    tx.tenant.findUniqueOrThrow({
      where: { id: ctx.tenantId },
      select: {
        slug: true,
        name: true,
        description: true,
        contactPhone: true,
        contactEmail: true,
        address: true,
        timezone: true,
        currency: true,
        bookingRequiresApproval: true,
        minLeadMinutes: true,
        maxAdvanceDays: true,
        pendingExpirationMinutes: true,
        publicCancellationMinutes: true,
      },
    }),
  );
}

export async function updateTenantSettings(ctx: TenantContext, input: TenantSettingsInput, actor: Actor) {
  const data = parseOrThrow(tenantSettingsSchema, input);
  return withTenant(ctx, async (tx) => {
    await tx.tenant.update({ where: { id: ctx.tenantId }, data });
    await audit(tx, { tenantId: ctx.tenantId, actor, action: "tenant.settings.updated", entityType: "tenant", entityId: ctx.tenantId, metadata: { ...data } });
  });
}
