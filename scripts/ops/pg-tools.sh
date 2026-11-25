#!/usr/bin/env bash
# Herramientas cliente de PostgreSQL con versión verificada. Se incluye con `source`.
#
# - PG_BIN (opcional): carpeta con pg_dump/pg_restore/psql, p. ej. /usr/lib/postgresql/18/bin.
#   Sin PG_BIN se usa la del PATH. En Ubuntu, /usr/bin/pg_dump es un "wrapper" que puede elegir
#   otra versión instalada: por eso los workflows fijan PG_BIN con la ruta absoluta.
# - pg_dump debe ser de una versión MAYOR O IGUAL que la del servidor (si no, aborta con
#   "server version mismatch"). pg_tools_check_server lo comprueba antes de empezar y explica
#   qué instalar, sin imprimir la URL de conexión.
PG_DUMP="${PG_BIN:+$PG_BIN/}pg_dump"
PG_RESTORE="${PG_BIN:+$PG_BIN/}pg_restore"
PSQL="${PG_BIN:+$PG_BIN/}psql"

pg_tool_major() { "$1" --version | sed -E 's/^[^0-9]*([0-9]+).*/\1/'; }

pg_tools_report() {
  local t
  for t in "$PG_DUMP" "$PG_RESTORE" "$PSQL"; do
    command -v "$t" >/dev/null || { echo "No se encontró $t (instalá postgresql-client o definí PG_BIN)" >&2; return 1; }
    echo "$(basename "$t"): $(command -v "$t") · $("$t" --version)" >&2
  done
  local d r p
  d="$(pg_tool_major "$PG_DUMP")"; r="$(pg_tool_major "$PG_RESTORE")"; p="$(pg_tool_major "$PSQL")"
  if [ "$d" != "$r" ] || [ "$d" != "$p" ]; then
    echo "pg_dump ($d), pg_restore ($r) y psql ($p) deben ser de la misma versión: definí PG_BIN" >&2
    return 1
  fi
}

# Los respaldos y restauraciones necesitan una sesión propia: a través del pooler de Neon
# (host con "-pooler", PgBouncer en modo transacción) la configuración de sesión que fija pg_restore
# se mezcla con otras conexiones y pg_dump puede fallar. Se exige el host directo.
pg_tools_reject_pooler() {
  case "$1" in
    *-pooler.*|*-pooler:*|*-pooler/*) echo "$2 usa el pooler de Neon (host con -pooler): usá el host directo, sin -pooler" >&2; return 1 ;;
  esac
}

# Uso: pg_tools_check_server "$URL" → falla si el cliente es más viejo que el servidor.
pg_tools_check_server() {
  local num server client
  num="$("$PSQL" "$1" -XAtqc "SHOW server_version_num")" || { echo "No se pudo conectar al servidor PostgreSQL" >&2; return 1; }
  server=$((num / 10000))
  client="$(pg_tool_major "$PG_DUMP")"
  echo "Servidor PostgreSQL $server · cliente $client" >&2
  if [ "$client" -lt "$server" ]; then
    echo "El cliente ($client) es más viejo que el servidor ($server): instalá postgresql-client-$server y definí PG_BIN=/usr/lib/postgresql/$server/bin" >&2
    return 1
  fi
}

# Conteo de filas de las tablas clave (para comparar origen y restauración).
PG_COUNT_SQL="SELECT 'tenants=' || count(*) FROM tenants UNION ALL SELECT 'users=' || count(*) FROM users UNION ALL SELECT 'bookings=' || count(*) FROM bookings UNION ALL SELECT 'customers=' || count(*) FROM customers UNION ALL SELECT 'booking_payments=' || count(*) FROM booking_payments UNION ALL SELECT 'tenant_assets=' || count(*) FROM tenant_assets UNION ALL SELECT 'court_images=' || count(*) FROM court_images UNION ALL SELECT 'audit_logs=' || count(*) FROM audit_logs UNION ALL SELECT 'migrations=' || count(*) FROM _prisma_migrations"
