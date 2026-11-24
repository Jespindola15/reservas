import { withTenant, type TenantContext } from "@/lib/db/tenant-context";
import { loadTransferSettings, type TransferInfo } from "./transfers";

/**
 * Datos de cobro que ve el JUGADOR para transferir (alias, CBU/CVU, titular, banco, instrucciones).
 * Son datos que el complejo eligió publicar para cobrar; no incluye nada más.
 */
export async function publicTransferInfo(ctx: TenantContext): Promise<TransferInfo | null> {
  return withTenant(ctx, (tx) => loadTransferSettings(tx, ctx.tenantId));
}
