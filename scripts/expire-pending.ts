/**
 * Job de vencimiento para cron del sistema:  `npm run job:expire`
 * (p. ej. `* * * * * cd /app && npm run -s job:expire`). Usa DATABASE_URL (rol de la app).
 */
import "dotenv/config";

async function main() {
  const { expirePendingBookings } = await import("../src/modules/jobs/expire-pending");
  const { prisma } = await import("../src/lib/db/prisma");
  try {
    const res = await expirePendingBookings();
    console.log(JSON.stringify({ job: "expire-pending", ...res }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
