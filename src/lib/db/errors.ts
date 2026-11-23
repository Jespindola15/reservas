/**
 * Clasificación de errores de PostgreSQL que llegan envueltos por Prisma 7 +
 * @prisma/adapter-pg. Forma observada (verificada empíricamente):
 *   e.code = "P2002" | "P2039" | ...
 *   e.meta.driverAdapterError.cause = { originalCode: "23P01", constraint?: { index }, originalMessage }
 * Estos detalles son internos: nunca se devuelven al cliente.
 */
type Cause = {
  originalCode?: string;
  code?: string;
  originalMessage?: string;
  constraint?: { index?: string; fields?: string[] };
};

function getCause(e: unknown): Cause | undefined {
  if (typeof e !== "object" || e === null) return undefined;
  const meta = (e as { meta?: { driverAdapterError?: { cause?: Cause } } }).meta;
  return meta?.driverAdapterError?.cause;
}

function pgCode(e: unknown): string | undefined {
  const cause = getCause(e);
  return cause?.originalCode ?? cause?.code;
}

/** 23P01: violación de restricción de exclusión (solapamiento de turnos). */
export function isExclusionViolation(e: unknown, constraint = "court_allocations_no_overlap"): boolean {
  if (pgCode(e) !== "23P01") return false;
  return getCause(e)?.originalMessage?.includes(constraint) ?? true;
}

/** 23505: violación de unicidad. Opcionalmente filtra por nombre de índice. */
export function isUniqueViolation(e: unknown, indexName?: string): boolean {
  const isUnique =
    pgCode(e) === "23505" || (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002");
  if (!isUnique) return false;
  if (!indexName) return true;
  const cause = getCause(e);
  return cause?.constraint?.index === indexName || (cause?.originalMessage?.includes(indexName) ?? false);
}

/** 42501: permiso denegado / violación de política RLS. */
export function isPermissionDenied(e: unknown): boolean {
  return pgCode(e) === "42501";
}
