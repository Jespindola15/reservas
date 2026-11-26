import { z } from "zod";
import { audit, type Actor } from "@/lib/audit";
import { withTenant, type TenantContext } from "@/lib/db/tenant-context";
import { parseOrThrow } from "@/lib/validation";
import { OWNER_MUTABLE_KINDS } from "@/modules/notifications/outbox";

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
  notificationsEnabled: z.boolean(),
  notifyPlayers: z.boolean(),
  notifyOwner: z.boolean(),
  ownerNotificationEmail: z.union([z.literal(""), z.email().max(254)]).optional().transform((v) => (v ? v.toLowerCase() : null)),
  reminderHoursBefore: z.number().int().min(0).max(48),
  digestEnabled: z.boolean(),
  digestHour: z.number().int().min(0).max(23),
  /** Avisos al complejo que NO se quieren recibir por email. */
  ownerEmailMuted: z.array(z.enum(OWNER_MUTABLE_KINDS)).max(OWNER_MUTABLE_KINDS.length).default([]).transform((v) => [...new Set(v)]),
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
        notificationsEnabled: true,
        notifyPlayers: true,
        notifyOwner: true,
        ownerNotificationEmail: true,
        reminderHoursBefore: true,
        digestEnabled: true,
        digestHour: true,
        ownerEmailMuted: true,
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
