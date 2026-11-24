#!/usr/bin/env bash
# Aplica las migraciones pendientes a una base REAL (Neon producción) de forma controlada.
#
#   export MIGRATION_DATABASE_URL='postgresql://reservas_owner:...@ep-xxx.REGION.aws.neon.tech/turnup?sslmode=require'
#   ./scripts/ops/migrate-prod.sh
#
# - Usa la conexión DIRECTA (host sin "-pooler"), con el rol reservas_owner.
# - Muestra a dónde apunta (sin contraseña), el estado y pide confirmación escrita.
# - Solo ejecuta `prisma migrate deploy` (nunca reset, push ni seed) y después db/verify.sql.
# - Hacé antes un punto de restauración (Neon: Branches → production → Create branch / snapshot).
set -euo pipefail
: "${MIGRATION_DATABASE_URL:?Definí MIGRATION_DATABASE_URL (conexión directa, rol reservas_owner)}"

parse() { node -e 'const u=new URL(process.argv[1]);console.log([u.username,u.hostname,u.pathname.slice(1),u.searchParams.get("sslmode")||""].join(" "))' "$MIGRATION_DATABASE_URL"; }
read -r DB_USER DB_HOST DB_NAME SSL <<<"$(parse)"

echo "Destino:  usuario=$DB_USER  host=$DB_HOST  base=$DB_NAME  sslmode=${SSL:-(ninguno)}"
case "$DB_HOST" in *-pooler.*) echo "ERROR: es la conexión POOLED. Para migrar usá la directa (sin -pooler)." >&2; exit 1 ;; esac
[ "$DB_USER" = "reservas_owner" ] || { echo "ERROR: migrá con el rol reservas_owner (no '$DB_USER')." >&2; exit 1; }
case "$DB_NAME" in *_test|*_e2e|*restore_test*) echo "Aviso: la base parece de pruebas ($DB_NAME)." ;; esac
if [[ "$DB_HOST" != "localhost" && "$DB_HOST" != "127.0.0.1" && "$SSL" != "require" && "$SSL" != "verify-full" ]]; then
  echo "ERROR: falta ?sslmode=require en la URL." >&2; exit 1
fi

echo; echo "== Estado actual =="
npx prisma migrate status || true   # devuelve código ≠ 0 si hay pendientes; se informa y se sigue

echo; read -r -p "Escribí APLICAR para ejecutar 'prisma migrate deploy' en $DB_HOST/$DB_NAME: " ans
[ "$ans" = "APLICAR" ] || { echo "Cancelado. No se modificó nada."; exit 1; }

npx prisma migrate deploy
echo; echo "== Verificación =="
if command -v psql >/dev/null; then
  psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/verify.sql
else
  node scripts/ops/verify-db.mjs
fi
