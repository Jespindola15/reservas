import { NextResponse } from "next/server";

/**
 * Chequeo "liviano" para monitores externos frecuentes (cada 1–5 min): confirma que el sitio y
 * las funciones responden SIN consultar la base. Así el monitor no mantiene despierta la base de
 * Neon (que se suspende tras 5 min sin uso y cobra/consume CU-horas mientras está activa).
 * El chequeo profundo (/api/health) consulta la base: usarlo con menos frecuencia.
 */
export function GET() {
  return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
