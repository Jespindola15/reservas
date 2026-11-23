import type { z } from "zod";
import { AppError } from "@/lib/errors";

/**
 * Valida con Zod y convierte fallas en AppError("VALIDATION_ERROR") con la
 * lista de campos inválidos (sin ecos del valor recibido).
 */
export function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const res = schema.safeParse(input);
  if (!res.success) {
    const fields = [...new Set(res.error.issues.map((i) => i.path.join(".") || "_"))];
    throw new AppError("VALIDATION_ERROR", { fields });
  }
  return res.data;
}
