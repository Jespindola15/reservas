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

Neon Console → proyecto → **Roles → New role** → nombre `turnup_backup`. Copiá la contraseña y guardala vos
(no la pegues en el chat). Después, en el **SQL Editor** (base `turnup`, conectado como `reservas_owner`):

```sql
GRANT CONNECT ON DATABASE turnup TO turnup_backup;
GRANT USAGE ON SCHEMA public TO turnup_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO turnup_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO turnup_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE reservas_owner IN SCHEMA public GRANT SELECT ON TABLES TO turnup_backup;
-- RLS: pg_dump necesita poder leer TODAS las filas. Sin esto aborta (no exporta tablas vacías).
ALTER ROLE turnup_backup BYPASSRLS;
```

El rol no puede escribir ni borrar nada. Si `ALTER ROLE ... BYPASSRLS` diera error de permisos, creá el
rol desde la consola (los roles de la consola ya pueden omitir RLS) y conservá solo los `GRANT SELECT`.

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
   `BACKUP_AGE_IDENTITY=turnup-backup-key.txt RESTORE_ADMIN_URL=<url-de-una-base-de-prueba> scripts/ops/restore-test.sh turnup-XXXX.dump.age`
   (crea una base temporal, restaura, cuenta filas y la borra).
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
