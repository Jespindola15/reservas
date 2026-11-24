/**
 * Crea (o promueve) el SUPERADMINISTRADOR real de TURNUP. Pensado para producción (Neon).
 *
 *   export MIGRATION_DATABASE_URL='postgresql://reservas_owner:...@HOST-DIRECTO/turnup?sslmode=require'
 *   npm run admin:superadmin                    # crea la cuenta o, si existe, la marca como superadmin
 *   npm run admin:superadmin -- --reset-password  # además cambia la contraseña y cierra sus sesiones
 *
 * - Pide email, nombre y contraseña por teclado (la contraseña no se muestra ni se registra).
 * - Hash compatible con Better Auth (scrypt de better-auth/crypto). Nada en texto plano.
 * - Idempotente: nunca duplica usuarios (email único); sin --reset-password no toca la contraseña.
 * - Deja registro en audit_logs (sin datos sensibles). No crea datos de demostración.
 */
import "dotenv/config";
import { createInterface } from "node:readline";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { PrismaClient } from "../../src/generated/prisma/client";

const reset = process.argv.includes("--reset-password");

/**
 * Entrada por teclado con UNA sola interfaz de lectura (si se crearan varias, la primera
 * consumiría todo lo que llega por stdin). Con `hidden`, no hace eco de lo escrito.
 */
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
let muted = false;
const rlOut = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
const originalWrite = rlOut._writeToOutput?.bind(rl);
rlOut._writeToOutput = (s: string) => {
  if (muted) return;
  if (originalWrite) originalWrite(s);
  else process.stdout.write(s);
};
const queued: string[] = [];
const waiters: ((line: string) => void)[] = [];
rl.on("line", (line) => {
  const w = waiters.shift();
  if (w) w(line);
  else queued.push(line);
});
rl.on("close", () => {
  for (const w of waiters.splice(0)) w("");
});

function ask(question: string, hidden = false): Promise<string> {
  process.stdout.write(question);
  muted = hidden;
  return new Promise((resolve) => {
    const done = (line: string) => {
      if (hidden) {
        muted = false;
        process.stdout.write("\n");
      }
      resolve(line);
    };
    const next = queued.shift();
    if (next !== undefined) done(next);
    else waiters.push(done);
  });
}

/**
 * Modo no interactivo (para ejecutarlo en otra máquina sin teclado):
 *   SUPERADMIN_EMAIL, SUPERADMIN_NAME y SUPERADMIN_PASSWORD_FILE (ruta a un archivo con la
 *   contraseña en la primera línea). El archivo nunca se imprime; borralo después.
 */
async function fromFiles(): Promise<{ email: string; name: string; password: string } | null> {
  const file = process.env.SUPERADMIN_PASSWORD_FILE;
  if (!file) return null;
  const { readFile } = await import("node:fs/promises");
  const password = ((await readFile(file, "utf8")).replace(/^\uFEFF/, "").split(/\r?\n/)[0] ?? "").trim();
  return { email: process.env.SUPERADMIN_EMAIL ?? "", name: process.env.SUPERADMIN_NAME ?? "", password };
}

async function main() {
  const preset = await fromFiles();
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("Definí MIGRATION_DATABASE_URL (rol reservas_owner, conexión directa).");
  const target = new URL(url);
  console.log(`Base: ${target.hostname}/${target.pathname.slice(1)} (usuario ${target.username})`);

  const email = z.email().max(254).parse((preset ? preset.email : await ask("Email del superadministrador: ")).trim().toLowerCase());
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const existing = await db.user.findUnique({ where: { email }, select: { id: true, platformRole: true, accounts: { where: { providerId: "credential" }, select: { id: true } } } });
    const needsPassword = !existing || existing.accounts.length === 0 || reset;
    const name = existing ? undefined : z.string().trim().min(2).max(100).parse(preset ? preset.name : await ask("Nombre para mostrar: "));

    let passwordHash: string | null = null;
    if (needsPassword) {
      const pw = preset ? preset.password : await ask("Contraseña (mínimo 12 caracteres, no se muestra): ", true);
      const pw2 = preset ? preset.password : await ask("Repetí la contraseña: ", true);
      if (pw !== pw2) throw new Error("Las contraseñas no coinciden.");
      if (pw.length < 12 || pw.length > 128) throw new Error("La contraseña debe tener entre 12 y 128 caracteres.");
      passwordHash = await hashPassword(pw);
    }

    const result = await db.$transaction(async (tx) => {
      let userId: string;
      let action: string;
      if (!existing) {
        const u = await tx.user.create({ data: { email, name: name!, platformRole: "SUPERADMIN", emailVerified: true }, select: { id: true } });
        await tx.account.create({ data: { userId: u.id, accountId: u.id, providerId: "credential", password: passwordHash! } });
        userId = u.id;
        action = "created";
      } else {
        userId = existing.id;
        await tx.user.update({ where: { id: userId }, data: { platformRole: "SUPERADMIN" } });
        if (passwordHash) {
          if (existing.accounts.length) await tx.account.updateMany({ where: { userId, providerId: "credential" }, data: { password: passwordHash } });
          else await tx.account.create({ data: { userId, accountId: userId, providerId: "credential", password: passwordHash } });
          await tx.session.deleteMany({ where: { userId } });
        }
        action = existing.platformRole === "SUPERADMIN" ? (passwordHash ? "password_reset" : "unchanged") : "promoted";
      }
      await tx.auditLog.create({
        data: { tenantId: null, actorType: "SYSTEM", actorUserId: null, action: `platform.superadmin.${action}`, entityType: "user", entityId: userId, metadata: { via: "scripts/ops/create-superadmin" } },
      });
      return action;
    });
    const msg: Record<string, string> = {
      created: "Superadministrador creado.",
      promoted: "La cuenta existente ahora es superadministradora (contraseña sin cambios).",
      password_reset: "Contraseña actualizada y sesiones cerradas.",
      unchanged: "Ya era superadministrador. No se cambió nada (usá --reset-password para cambiar la contraseña).",
    };
    console.log(msg[result]);
  } finally {
    await db.$disconnect();
    rl.close();
  }
}

main().catch((e) => {
  console.error(e instanceof z.ZodError ? "Dato inválido: revisá el email/nombre." : e instanceof Error ? e.message : String(e));
  process.exit(1);
});
