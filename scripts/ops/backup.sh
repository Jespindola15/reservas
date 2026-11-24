#!/usr/bin/env bash
# Backup lógico de PostgreSQL (formato custom, comprimido), con retención local.
#
#   BACKUP_DATABASE_URL=postgresql://... BACKUP_DIR=/ruta ./scripts/ops/backup.sh
#
# - Usá un rol de SOLO LECTURA para backups (no el de la app ni el dueño).
# - La URL se lee de una variable de entorno; nunca se imprime.
# - Retención: BACKUP_KEEP_DAYS (por defecto 14). Copiá además los archivos fuera del servidor
#   (bucket con versionado/inmutabilidad). Ver docs/INFRAESTRUCTURA.md.
set -euo pipefail
: "${BACKUP_DATABASE_URL:?Definí BACKUP_DATABASE_URL}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
umask 077
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/turnup-$stamp.dump"
pg_dump --dbname="$BACKUP_DATABASE_URL" --format=custom --compress=9 --no-owner --no-privileges --file="$out.partial"
mv "$out.partial" "$out"
sha256sum "$out" > "$out.sha256"
pg_restore --list "$out" > /dev/null   # verifica que el archivo sea legible
find "$BACKUP_DIR" -name 'turnup-*.dump*' -type f -mtime +"$KEEP_DAYS" -delete
echo "{\"backup\":\"$(basename "$out")\",\"bytes\":$(stat -c %s "$out")}"
