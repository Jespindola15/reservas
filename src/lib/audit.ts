import type { ActorType, Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db/tenant-context";

export type Actor = {
  type: ActorType;
  userId: string | null;
  ip?: string | null;
};

export const PUBLIC_ACTOR = (ip?: string | null): Actor => ({ type: "PUBLIC", userId: null, ip: ip ?? null });

/**
 * Registra un evento en audit_logs dentro de la MISMA transacción que la
 * operación: si la operación se revierte, el registro también (y viceversa).
 * La tabla es de solo inserción para el rol de la aplicación.
 * No guardar secretos ni datos sensibles completos en metadata.
 */
export async function audit(
  tx: Tx,
  entry: {
    tenantId: string | null;
    actor: Actor;
    action: string;
    entityType: string;
    entityId?: string | null;
    metadata?: Prisma.InputJsonValue;
  },
) {
  await tx.auditLog.create({
    data: {
      tenantId: entry.tenantId,
      actorType: entry.actor.type,
      actorUserId: entry.actor.userId,
      ip: entry.actor.ip ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      metadata: entry.metadata,
    },
  });
}
