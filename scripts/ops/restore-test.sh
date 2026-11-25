#!/usr/bin/env bash
# Prueba de restauración: restaura un backup en una base DESCARTABLE y verifica datos básicos.
#
#   RESTORE_ADMIN_URL=postgresql://postgres@localhost/postgres ./scripts/ops/restore-test.sh backups/turnup-XXXX.dump
#   # o, si el rol no puede crear bases (p. ej. Neon), con una base vacía creada antes desde la consola:
#   RESTORE_TARGET_URL=postgresql://.../turnup_restore_test_xxx ./scripts/ops/restore-test.sh backups/turnup-XXXX.dump
#
# Seguridad: la base destino SIEMPRE se llama turnup_restore_test_<fecha>; el script se niega a
# continuar si el nombre no termina así. Nunca restaura sobre producción.
set -euo pipefail
[ -n "${RESTORE_ADMIN_URL:-}${RESTORE_TARGET_URL:-}" ] || { echo "Definí RESTORE_ADMIN_URL o RESTORE_TARGET_URL (servidor de PRUEBA)" >&2; exit 1; }
dump="${1:?Indicá el archivo .dump (o .dump.age)}"
[ -f "$dump.sha256" ] && (cd "$(dirname "$dump")" && sha256sum --check --quiet "$(basename "$dump").sha256")
if [[ "$dump" == *.age ]]; then
  : "${BACKUP_AGE_IDENTITY:?Definí BACKUP_AGE_IDENTITY (archivo con la clave privada age) para descifrar}"
  plain="$(mktemp --suffix=.dump)"
  trap 'rm -f "$plain"' EXIT
  age --decrypt --identity "$BACKUP_AGE_IDENTITY" --output "$plain" "$dump"
  dump="$plain"
fi
if [ -n "${RESTORE_TARGET_URL:-}" ]; then
  target="$RESTORE_TARGET_URL"
  db="$(basename "${target%%\?*}")"
else
  db="turnup_restore_test_$(date -u +%Y%m%d%H%M%S)"
fi
case "$db" in turnup_restore_test*) ;; *) echo "La base destino debe llamarse turnup_restore_test_*: nunca se restaura sobre otra base" >&2; exit 1 ;; esac
if [ -z "${RESTORE_TARGET_URL:-}" ]; then
  psql "$RESTORE_ADMIN_URL" -v ON_ERROR_STOP=1 -qc "CREATE DATABASE \"$db\""
  base="${RESTORE_ADMIN_URL%%\?*}"
  query=""
  [ "$base" != "$RESTORE_ADMIN_URL" ] && query="?${RESTORE_ADMIN_URL#*\?}"
  target="${base%/*}/$db$query"
fi
pg_restore --dbname="$target" --no-owner --no-privileges --exit-on-error "$dump"
psql "$target" -v ON_ERROR_STOP=1 -Atc "SELECT 'tenants=' || count(*) FROM tenants UNION ALL SELECT 'users=' || count(*) FROM users UNION ALL SELECT 'bookings=' || count(*) FROM bookings UNION ALL SELECT 'customers=' || count(*) FROM customers UNION ALL SELECT 'tenant_assets=' || count(*) FROM tenant_assets UNION ALL SELECT 'court_images=' || count(*) FROM court_images UNION ALL SELECT 'audit_logs=' || count(*) FROM audit_logs UNION ALL SELECT 'migrations=' || count(*) FROM _prisma_migrations"
echo "Restauración OK en $db. Borrala cuando termines: DROP DATABASE \"$db\";"
