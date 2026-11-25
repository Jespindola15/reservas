# Respaldos independientes de TURNUP

Una rama de Neon **no** reemplaza un respaldo: vive en el mismo proyecto y la misma cuenta, y un borrado de
proyecto, un error de credenciales o una cuenta comprometida se la llevan junto con producción. Por eso hay
un respaldo lógico, cifrado y guardado fuera de Neon.

## Qué se respalda

| Qué | Cómo | Frecuencia | Retención |
|---|---|---|---|
| Base de datos completa | `pg_dump` (formato custom) cifrado con `age` | Semanal (lunes 04:17 AR) y a demanda | 30 días (artefacto privado de GitHub Actions) |
| Imágenes en R2 | `aws s3 sync` del bucket → tar cifrado con `age` | Junto con la base | 30 días |
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

- 26 tablas tienen seguridad por filas (RLS). Sin BYPASSRLS, `pg_dump` aborta o exportaría tablas vacías.
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
- Opcional, imágenes: `R2_BACKUP_ENDPOINT`, `R2_BACKUP_BUCKET`, `R2_BACKUP_ACCESS_KEY_ID`,
  `R2_BACKUP_SECRET_ACCESS_KEY` (token de R2 de **solo lectura**).

### 4. Primera ejecución

Actions → **Respaldo cifrado** → *Run workflow*. Debe terminar en verde con "Integridad OK" en el resumen.

## Restauración (siempre en una base nueva, nunca sobre producción)

1. Descargá el artefacto `turnup-backup-<id>` desde Actions.
2. Probalo en una base aislada:
   - En Neon: creá una rama nueva y, dentro de ella, una base vacía llamada `turnup_restore_test_<fecha>`.
   - Ejecutá: `BACKUP_AGE_IDENTITY=turnup-backup-key.txt RESTORE_TARGET_URL=<url-de-esa-base> scripts/ops/restore-test.sh turnup-XXXX.dump.age`
   - El script verifica la suma SHA-256, descifra, restaura y cuenta filas. Se niega a restaurar sobre una base con otro nombre.
   - Al terminar, borrá la rama.
3. Restauración real ante un desastre: crear una rama o proyecto **nuevo** en Neon, restaurar ahí con
   `pg_restore --no-owner --dbname=<nueva>`, verificar y recién entonces apuntar Netlify a esa base.
4. Imágenes: `age -d -i turnup-backup-key.txt imagenes-XXXX.tar.age | tar -x` y `aws s3 sync images s3://<bucket>`.

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

**Pendiente para dar el sistema por terminado:**

- Crear el rol (paso 1), la clave (paso 2) y los secretos (paso 3).
- Correr el workflow una vez y descargar el artefacto.
- Restaurarlo con `restore-test.sh`.
- Hasta que el workflow semanal corra en verde y se restaure su artefacto, el respaldo automático **no está verificado**.
