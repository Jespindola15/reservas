#!/usr/bin/env bash
# Prueba de restauración: restaura un backup en una base DESCARTABLE y verifica datos básicos.
#
#   RESTORE_ADMIN_URL=postgresql://postgres@localhost/postgres ./scripts/ops/restore-test.sh backups/turnup-XXXX.dump
#
# Seguridad: la base destino SIEMPRE se llama turnup_restore_test_<fecha>; el script se niega a
# continuar si el nombre no termina así. Nunca restaura sobre producción.
set -euo pipefail
: "${RESTORE_ADMIN_URL:?Definí RESTORE_ADMIN_URL (servidor de PRUEBA)}"
dump="${1:?Indicá el archivo .dump (o .dump.age)}"
[ -f "$dump.sha256" ] && (cd "$(dirname "$dump")" && sha256sum --check --quiet "$(basename "$dump").sha256")
if [[ "$dump" == *.age ]]; then
  : "${BACKUP_AGE_IDENTITY:?Definí BACKUP_AGE_IDENTITY (archivo con la clave privada age) para descifrar}"
  plain="$(mktemp --suffix=.dump)"
  trap 'rm -f "$plain"' EXIT
  age --decrypt --identity "$BACKUP_AGE_IDENTITY" --output "$plain" "$dump"
  dump="$plain"
fi
db="turnup_restore_test_$(date -u +%Y%m%d%H%M%S)"
case "$db" in turnup_restore_test_*) ;; *) echo "Nombre de base inesperado" >&2; exit 1 ;; esac
psql "$RESTORE_ADMIN_URL" -v ON_ERROR_STOP=1 -qc "CREATE DATABASE \"$db\""
base="${RESTORE_ADMIN_URL%%\?*}"
query=""
[ "$base" != "$RESTORE_ADMIN_URL" ] && query="?${RESTORE_ADMIN_URL#*\?}"
target="${base%/*}/$db$query"
pg_restore --dbname="$target" --no-owner --no-privileges --exit-on-error "$dump"
psql "$target" -v ON_ERROR_STOP=1 -Atc "SELECT 'tenants=' || count(*) FROM tenants UNION ALL SELECT 'bookings=' || count(*) FROM bookings UNION ALL SELECT 'migrations=' || count(*) FROM _prisma_migrations"
echo "Restauración OK en $db. Borrala cuando termines: DROP DATABASE \"$db\";"
