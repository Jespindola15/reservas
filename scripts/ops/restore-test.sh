#!/usr/bin/env bash
# Prueba de restauración: restaura un backup en una base DESCARTABLE y verifica datos básicos.
#
#   RESTORE_ADMIN_URL=postgresql://postgres@localhost/postgres ./scripts/ops/restore-test.sh backups/turnup-XXXX.dump
#   # o, si el rol no puede crear bases (p. ej. Neon), con una base vacía creada antes desde la consola:
#   RESTORE_TARGET_URL=postgresql://.../turnup_restore_test_xxx ./scripts/ops/restore-test.sh backups/turnup-XXXX.dump
#
# Seguridad: la base destino SIEMPRE se llama turnup_restore_test_<fecha>; el script se niega a
# continuar si el nombre no termina así. Nunca restaura sobre producción.
# PG_BIN: cliente PostgreSQL de la misma versión que el servidor de prueba (18 para producción).
# Las líneas "tabla=conteo" van a la salida estándar (las usa backup.sh para comparar).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=pg-tools.sh
source "$here/pg-tools.sh"
pg_tools_report
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
  pg_tools_check_server "$RESTORE_ADMIN_URL"
  "$PSQL" "$RESTORE_ADMIN_URL" -X -v ON_ERROR_STOP=1 -qc "CREATE DATABASE \"$db\""
  base="${RESTORE_ADMIN_URL%%\?*}"
  query=""
  [ "$base" != "$RESTORE_ADMIN_URL" ] && query="?${RESTORE_ADMIN_URL#*\?}"
  target="${base%/*}/$db$query"
fi
pg_tools_reject_pooler "$target" "La base de prueba"
pg_tools_check_server "$target"
# El destino debe estar vacío: nunca se mezcla con datos existentes.
existing="$("$PSQL" "$target" -XAtqc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")"
[ "$existing" = "0" ] || { echo "La base $db no está vacía ($existing tablas): usá una nueva" >&2; exit 1; }
"$PG_RESTORE" --dbname="$target" --no-owner --no-privileges --exit-on-error "$dump"
"$PSQL" "$target" -XAtq -v ON_ERROR_STOP=1 -c "$PG_COUNT_SQL"
rls="$("$PSQL" "$target" -XAtqc "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity")"
echo "Restauración OK en $db ($rls tablas con RLS). Borrala cuando termines: DROP DATABASE \"$db\";" >&2
