import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { getEnv } from "@/lib/env";

/**
 * Cifra valores sensibles de vida corta (token de invitación, enlace de reseteo)
 * que deben pasar por la cola de emails. Clave derivada del secreto del servidor
 * con una etiqueta propia. Se borran de la cola cuando el envío termina.
 */
const key = () => `${getEnv().BETTER_AUTH_SECRET}:turnup-outbox-v1`;

export async function seal(value: string): Promise<string> {
  return symmetricEncrypt({ key: key(), data: value });
}

export async function unseal(sealed: string): Promise<string> {
  return symmetricDecrypt({ key: key(), data: sealed });
}
