#!/usr/bin/env bash
# Backup lógico de PostgreSQL (formato custom, comprimido), con retención local.
#
#   BACKUP_DATABASE_URL=postgresql://... BACKUP_DIR=/ruta PG_BIN=/usr/lib/postgresql/18/bin ./scripts/ops/backup.sh
#
# - Usá un rol de SOLO LECTURA para backups (no el de la app ni el dueño).
# - La URL se lee de una variable de entorno; nunca se imprime.
# - PG_BIN: carpeta del cliente PostgreSQL de la MISMA versión mayor que el servidor o más nueva
#   (producción usa PostgreSQL 18). Se verifica antes de empezar.
# - Retención: BACKUP_KEEP_DAYS (por defecto 14). Copiá además los archivos fuera del servidor.
# - Prueba de restauración (opcional): con BACKUP_VERIFY_RESTORE_URL (base vacía y DESCARTABLE
#   llamada turnup_restore_test*), el respaldo se restaura ahí ANTES de cifrarlo y se comparan
#   los conteos de las tablas clave con el origen. Si no coinciden, el respaldo falla.
# - Cifrado: si definís BACKUP_AGE_RECIPIENT (clave pública "age1..."), el respaldo se cifra con
#   age y el archivo sin cifrar se borra. La clave PRIVADA no está en el servidor ni en el repo:
#   solo la necesita quien restaura.
set -euo pipefail
: "${BACKUP_DATABASE_URL:?Definí BACKUP_DATABASE_URL}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=pg-tools.sh
source "$here/pg-tools.sh"
pg_tools_report
pg_tools_reject_pooler "$BACKUP_DATABASE_URL" BACKUP_DATABASE_URL
pg_tools_check_server "$BACKUP_DATABASE_URL"

BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
umask 077
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/turnup-$stamp.dump"
# Con RLS activo, pg_dump necesita un rol con BYPASSRLS (si no, aborta en vez de exportar tablas vacías).
"$PG_DUMP" --dbname="$BACKUP_DATABASE_URL" --format=custom --compress=9 --no-owner --no-privileges --file="$out.partial"
mv "$out.partial" "$out"
# Sumas con el nombre del archivo solo (se verifican desde la carpeta del respaldo).
sum_of() { (cd "$(dirname "$1")" && sha256sum "$(basename "$1")") > "$1.sha256"; }
sum_of "$out"
"$PG_RESTORE" --list "$out" > /dev/null   # verifica que el archivo sea legible

if [ -n "${BACKUP_VERIFY_RESTORE_URL:-}" ]; then
  trap 'rm -f "$BACKUP_DIR/.origen.txt" "$BACKUP_DIR/.restaurado.txt"' EXIT
  "$PSQL" "$BACKUP_DATABASE_URL" -XAtq -v ON_ERROR_STOP=1 -c "$PG_COUNT_SQL" > "$BACKUP_DIR/.origen.txt"
  RESTORE_TARGET_URL="$BACKUP_VERIFY_RESTORE_URL" bash "$here/restore-test.sh" "$out" > "$BACKUP_DIR/.restaurado.txt"
  if ! diff <(grep '=' "$BACKUP_DIR/.origen.txt") <(grep '=' "$BACKUP_DIR/.restaurado.txt") >&2; then
    echo "La restauración de prueba no coincide con el origen: respaldo descartado" >&2
    exit 1
  fi
  echo "Restauración verificada: $(grep -c '=' "$BACKUP_DIR/.origen.txt") tablas con los mismos conteos" >&2
  sed 's/^/  /' "$BACKUP_DIR/.origen.txt" >&2
fi

if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
  age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" --output "$out.age" "$out"
  sum_of "$out.age"
  rm -f "$out" "$out.sha256"
  out="$out.age"
fi
find "$BACKUP_DIR" -name 'turnup-*.dump*' -type f -mtime +"$KEEP_DAYS" -delete
echo "{\"backup\":\"$(basename "$out")\",\"bytes\":$(stat -c %s "$out")}"
