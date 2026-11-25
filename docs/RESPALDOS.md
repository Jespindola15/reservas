# Respaldos independientes de TURNUP

Una rama de Neon **no** reemplaza un respaldo: vive en el mismo proyecto y la misma cuenta, y un borrado de
proyecto, un error de credenciales o una cuenta comprometida se la llevan junto con producción. Por eso hay
un respaldo lógico, cifrado y guardado fuera de Neon.

## Qué se respalda

| Qué | Cómo | Frecuencia | Retención |
|---|---|---|---|
| Base de datos completa | `pg_dump` (formato custom) cifrado con `age` | Semanal (lunes 04:17 AR) y a demanda | 30 días (artefacto privado de GitHub Actions) |
| Imágenes en Supabase Storage | `aws s3 sync` del bucket (protocolo S3) → tar cifrado con `age` | Junto con la base | 30 días |
| Antes de cada migración | Rama de respaldo de Neon + `pg_dump` manual | Cada migración | Hasta validar el deploy |
| Historial de Neon | Restauración a un momento (PITR) del plan gratuito | Continuo | El que ofrezca el plan |

## Configuración (una sola vez)

### 1. Rol de solo lectura en Neon

**No lo crees desde Roles → New role** de la consola. Esos roles entran al grupo `neon_superuser` y pueden
crear roles y bases: es mucho más permiso del necesario. Crealo por SQL, sin esos privilegios.

Neon Console → proyecto → **SQL Editor** → base `turnup`, rol **`neondb_owner`**. Inventá una contraseña
larga (por ejemplo, con tu gestor de contraseñas), reemplazala abajo y ejecutá:

```sql
CREATE ROLE turnup_backup LOGIN PASSWORD 'PEGAR-ACA-UNA-CONTRASEÑA-LARGA'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT BYPASSRLS CONNECTION LIMIT 2;
GRANT CONNECT ON DATABASE turnup TO turnup_backup;
GRANT USAGE ON SCHEMA public TO turnup_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO turnup_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO turnup_backup;
```

Después borrá esa consulta del historial del SQL Editor, y no pegues la contraseña en el chat.

Las tablas nuevas de futuras migraciones también quedan legibles para este rol:
`scripts/ops/neon-safe-migrate.mjs` repite los `GRANT SELECT` al final de cada migración si el rol existe.

**Por qué BYPASSRLS y por qué es seguro:**

- Todas las tablas de negocio tienen seguridad por filas (RLS). Sin BYPASSRLS, `pg_dump` aborta o exportaría tablas vacías.
- BYPASSRLS solo quita el filtro de filas: **no da permiso de escritura**. El rol tiene únicamente `SELECT`.
- La aplicación se conecta como `reservas_app`, que no es miembro de `turnup_backup` y no puede usarlo
  (`SET ROLE` falla). La contraseña solo vive en los secretos de GitHub, nunca en Netlify.
- Límite de 2 conexiones simultáneas y sin `INHERIT`: no hereda permisos de otros roles.

**Verificación** (en el SQL Editor, después de crearlo):

```sql
SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolconnlimit FROM pg_roles WHERE rolname = 'turnup_backup';
-- Esperado: f, f, f, t, 2
SELECT count(*) FROM information_schema.role_table_grants
 WHERE grantee = 'turnup_backup' AND privilege_type <> 'SELECT';
-- Esperado: 0 (ningún permiso de escritura)
SELECT pg_has_role('reservas_app', 'turnup_backup', 'USAGE');
-- Esperado: f (la app no puede usar el rol de respaldo)
```

### 2. Clave de cifrado

En tu computadora: `age-keygen -o turnup-backup-key.txt`. Guardá ese archivo **fuera** del repo (gestor de
contraseñas o pendrive). La línea `# public key: age1...` es la clave pública.

### 3. Secretos en GitHub

Repositorio → **Settings → Secrets and variables → Actions → New repository secret**:

- `BACKUP_DATABASE_URL`: `postgresql://turnup_backup:<contraseña>@<host-directo-de-neon>/turnup?sslmode=require`
  (el host **sin** `-pooler`).
- `BACKUP_AGE_RECIPIENT`: la clave pública `age1...`.
- Imágenes (Supabase Storage):
  - `STORAGE_BACKUP_ENDPOINT`: `https://<ref>.storage.supabase.co/storage/v1/s3`
  - `STORAGE_BACKUP_REGION`: p. ej. `sa-east-1`
  - `STORAGE_BACKUP_BUCKET`: `turnup-images`
  - `STORAGE_BACKUP_ACCESS_KEY_ID` y `STORAGE_BACKUP_SECRET_ACCESS_KEY`: la clave `turnup-github-respaldo` (docs/IMAGENES.md, paso 6).

  Supabase no ofrece claves S3 de solo lectura: estas claves pueden escribir. Por eso viven solo en
  los secretos de GitHub (cifrados, invisibles en los registros) y el workflow solo ejecuta lecturas
  (`sync` desde el bucket y `list-objects`). Con estos mismos secretos funciona `storage-keepalive.yml`,
  que evita la pausa por inactividad del plan gratuito.

### 4. Primera ejecución

Actions → **Respaldo cifrado** → *Run workflow*. Debe terminar en verde. El resumen del job muestra:

- `Cliente PostgreSQL: pg_dump (PostgreSQL) 18.x` y `Servidor PostgreSQL 18 · cliente 18`.
- `Restauración verificada: 9 tablas con los mismos conteos` y los conteos (tenants, users, bookings…).
- `Archivo cifrado e íntegro: ./turnup-….dump.age`.
- `Imágenes respaldadas: N archivos, B bytes` (si cargaste los secretos de Supabase).

### Versión de PostgreSQL

Producción (Neon) usa **PostgreSQL 18**. `pg_dump` aborta si es más viejo que el servidor
("server version mismatch"), así que el workflow instala `postgresql-client-18`, usa las rutas absolutas
`/usr/lib/postgresql/18/bin/…` (en Ubuntu, `/usr/bin/pg_dump` puede elegir otra versión instalada) y
verifica las tres herramientas antes de empezar. `scripts/ops/backup.sh` y `restore-test.sh` vuelven a
comparar la versión del cliente con la del servidor y explican qué instalar si no alcanza.

**Si Neon pasa a PostgreSQL 19:** cambiá `PG_MAJOR: "18"` y la imagen `postgres:18` en
`.github/workflows/backup.yml`. Para usarlo en tu computadora: `PG_BIN=/ruta/a/postgresql/18/bin`.

### Prueba de restauración en cada respaldo

Antes de cifrar, el job restaura el respaldo en una base PostgreSQL 18 **descartable** que solo existe
durante el job (servicio `restore`, sin acceso a internet ni a producción) y compara los conteos de las
tablas clave con producción. Si algo no coincide, el respaldo falla y no se sube. El archivo sin cifrar
nunca sale del job: solo se sube el `.dump.age`.

## Restauración (siempre en una base nueva, nunca sobre producción)

1. Descargá el artefacto `turnup-backup-<id>` desde Actions.
2. Probalo en una base aislada:
   - En Neon: creá una rama nueva y, dentro de ella, una base vacía llamada `turnup_restore_test_<fecha>`.
   - Ejecutá: `PG_BIN=<carpeta del cliente PostgreSQL 18> BACKUP_AGE_IDENTITY=turnup-backup-key.txt RESTORE_TARGET_URL=<url-de-esa-base> scripts/ops/restore-test.sh turnup-XXXX.dump.age`
   - El script verifica la suma SHA-256, descifra, restaura y cuenta filas. Se niega a restaurar sobre una base con otro nombre o que no esté vacía.
   - Al terminar, borrá la rama.
3. Restauración real ante un desastre: crear una rama o proyecto **nuevo** en Neon, restaurar ahí con
   `pg_restore --no-owner --dbname=<nueva>`, verificar y recién entonces apuntar Netlify a esa base.
4. Imágenes: `age -d -i turnup-backup-key.txt imagenes-XXXX.tar.age | tar -x` y luego
   `aws s3 sync images s3://turnup-images --endpoint-url <endpoint-de-supabase>` (con las claves S3 del proyecto destino).
   Las claves de los objetos no cambian, así que las referencias en Neon siguen siendo válidas.

## Borrado accidental

- Una fila o un complejo borrado por error: restaurá el respaldo en una base aparte y copiá solo lo que falta.
- La app no borra en cascada: complejos y usuarios se archivan o anonimizan, y las reservas y pagos se conservan.
- Neon permite volver una rama a un momento anterior (PITR) dentro de la ventana del plan: es el camino más
  rápido para un error reciente, pero pisa todo lo posterior. Usalo creando primero una rama de respaldo.

## Verificación periódica

- Cada mes: descargá el último artefacto y corré `restore-test.sh`. Anotá la fecha y los conteos.
- Si el workflow falla o se saltea porque faltan secretos, el resumen del job lo dice.

## Prueba de restauración realizada (25/11/2026)

En un entorno aislado, con los scripts del repo:

1. `backup.sh` sobre producción, solo lectura. Se usó el rol dueño de las tablas porque `turnup_backup` todavía no existe. Volcado de 152 KB, cifrado con `age`, con suma SHA-256. Tardó 27 s.
2. Se creó una rama de Neon nueva con una base vacía `turnup_restore_test_*`.
3. `restore-test.sh`: verificó la suma, descifró y restauró sin errores en 67 s.
4. Conteos restaurados: 3 complejos, 3 usuarios, 3 reservas, 3 clientes, 27 registros de auditoría y las 12 migraciones.
   Coinciden con producción al momento del volcado. Un complejo y un registro de auditoría se crearon en producción 2 minutos después del volcado.
5. Se borraron la rama, el volcado y la clave temporal.

## Corrección PostgreSQL 18 (25/11/2026)

El primer run del workflow falló con `server version mismatch` (servidor 18.7, pg_dump 17.12). Cambios y pruebas:

1. Workflow con `postgresql-client-18`, rutas absolutas y verificación de versión y PATH de pg_dump,
   pg_restore y psql. Los scripts comparan la versión del cliente con la del servidor antes de empezar.
2. Se reprodujo el error con un cliente 16 contra un servidor 18: ahora se corta antes de volcar, con el
   paquete a instalar en el mensaje.
3. Simulación local de todos los pasos del workflow (PostgreSQL 18 + emulador S3 con estilo "path"):
   volcado, restauración de prueba con conteos iguales, archivo `.dump.age` íntegro y con cabecera age,
   y respaldo de imágenes con bucket vacío y con 3 imágenes (descifradas, idénticas a las originales).
4. Copia aislada de producción (rama temporal de Neon, borrada al terminar): volcado con pg_dump 18.7,
   restauración de prueba en una base vacía con los mismos conteos (4 complejos, 4 usuarios, 4 reservas,
   4 clientes, 34 registros de auditoría, 12 migraciones), y luego descifrado del `.dump.age` y
   restauración completa con `restore-test.sh` (68 s). Extensiones: solo plpgsql y btree_gist.
5. El rol `turnup_backup` de producción está bien configurado: BYPASSRLS, sin herencia, límite 2,
   SELECT en las 33 tablas y en las secuencias, ningún permiso de escritura, la app no puede usarlo.
6. Hallazgo: a través del pooler de Neon (`-pooler`) la restauración deja la sesión con `search_path`
   vacío. Los scripts ahora rechazan URLs con `-pooler`. Verificá que `BACKUP_DATABASE_URL` use el host directo.
7. Las 254 pruebas de integración pasan contra PostgreSQL 18; la integración continua usa `postgres:18`.

**Pendiente para dar el sistema por terminado:**

- Crear el rol (paso 1), la clave (paso 2) y los secretos (paso 3).
- Correr el workflow una vez y descargar el artefacto.
- Restaurarlo con `restore-test.sh`.
- Hasta que el workflow semanal corra en verde y se restaure su artefacto, el respaldo automático **no está verificado**.
