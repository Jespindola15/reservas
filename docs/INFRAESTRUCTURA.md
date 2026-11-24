# TURNUP — Infraestructura y operación (Fase 3)

## 1. Auditoría del despliegue (Bloque A)

Lo que se pudo **verificar desde el repositorio** y lo que **no** (no tengo acceso al panel de Netlify, a la base
de producción ni a sus variables).

| # | Punto | Verificado en el repo | Sin verificar (requiere acceso) |
|---|---|---|---|
| 1 | Estructura y scripts | Next.js 16, `npm run build`, `postinstall: prisma generate`. | — |
| 2 | Configuración de deploy | `netlify.toml` (Node 22, `npm run build`); repo `github.com/Jespindola15/reservas`; Netlify despliega automáticamente al hacer push. | Rama de producción configurada, deploy previews, plugin de Next activo. |
| 3 | Dónde corre Next.js | En **funciones serverless de Netlify** (adaptador de Next). No hay proceso persistente. | Región de las funciones. |
| 4 | Dónde está PostgreSQL | **No determinado.** Respuesta del dueño: “todavía no hay base” y a la vez “variables y migraciones cargadas”. Son contradictorias. | Proveedor, región, versión, si existe `btree_gist`, si se pudieron crear los roles `reservas_owner`/`reservas_app`. |
| 5 | Persistente o serverless | Serverless (Netlify Functions). Consecuencia: el temporizador en memoria **no sirve**; se usa la función programada. | — |
| 6 | Variables de entorno | Se leen de Netlify (*Site configuration → Environment variables*). La app valida todo con Zod al primer uso y, si falta algo, muestra “Servicio no disponible” y lo registra (`startup.config_invalid`). | Qué variables están cargadas y con qué valores. |
| 7 | Migraciones | **No se aplican en el build** (a propósito: el build no tiene credenciales de dueño). Se aplican a mano con `prisma migrate deploy`. | Qué migraciones tiene aplicadas la base real (`SELECT migration_name FROM _prisma_migrations`). |
| 8 | Riesgos de pérdida de datos | Las 2 migraciones nuevas son **aditivas** (columnas con default, tablas nuevas, una columna que pasa a aceptar NULL, funciones `CREATE OR REPLACE`). Ningún `DROP` de datos. | Backups del proveedor activos. |
| 9 | Better Auth detrás del proxy | Requiere `BETTER_AUTH_URL` = dominio real con https y `AUTH_CLIENT_IP_HEADER=x-nf-client-connection-ip`. En *deploy previews* el login no funciona (origen distinto): esperado. | Valores reales cargados. |
| 10 | Vencimiento de reservas | Fase 2 usaba un `setInterval` dentro de Next: **en Netlify no corre de forma confiable**. Ahora: función programada → `/api/internal/jobs/tick`; el temporizador interno se apaga solo en serverless. | Que la función programada figure como activa en Netlify (*Functions → Scheduled*) y que `CRON_SECRET` esté cargado. |

**No afirmo que producción esté correctamente configurada**: hasta que se confirme lo de la columna derecha,
el estado de producción es desconocido.

### Comprobación rápida (5 minutos, con acceso)

1. Netlify → *Environment variables*: existen `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
   `AUTH_CLIENT_IP_HEADER`, `CRON_SECRET`, `EXPIRATION_SCHEDULER=off`.
2. En la base: `SELECT migration_name FROM _prisma_migrations ORDER BY 1;` debe listar las 7 migraciones.
3. `curl https://TU-SITIO/api/health` → `{"status":"ok"}` (o `degraded` con motivo si se consulta con el secreto:
   `curl -H "Authorization: Bearer $CRON_SECRET" https://TU-SITIO/api/health`).
4. Netlify → *Logs → Functions → expire-pending*: una ejecución cada 30 min con `tick: 200`.

## 2. Orden seguro de despliegue de esta fase

1. **Backup** de la base de producción (sección 5).
2. Aplicar migraciones **antes** de hacer push (el código viejo funciona con el esquema nuevo porque es aditivo):
   `MIGRATION_DATABASE_URL="postgresql://reservas_owner:...@HOST/DB?sslmode=require" npx prisma migrate deploy`
3. Cargar `CRON_SECRET` (≥ 32 caracteres) si no está, y `EXPIRATION_SCHEDULER=off`.
4. Push → Netlify despliega solo.
5. Verificar `/api/health` con el secreto.

Si se hace al revés (push primero), las páginas que usan columnas nuevas fallan hasta migrar; no se pierden datos.

## 3. Tareas programadas

- **Una sola**: `netlify/functions/expire-pending.mts` (cron `*/30 * * * *`) → `POST /api/internal/jobs/tick`.
  Cada 30 min para no mantener despierta la base de Neon (plan Free: 100 CU-h/mes).
- El tick: vencimientos → recordatorios/resúmenes → envío de emails (lotes de 50) → limpieza (1 vez por hora).
- Cada paso registra su resultado en `job_runs` (última ejecución, último éxito, error saneado, fallas seguidas).
- Concurrencia: dos ticks simultáneos no duplican vencimientos ni emails (probado: 3 ticks en paralelo).
- En un servidor persistente: `EXPIRATION_SCHEDULER=internal` **o** cron del sistema (`npm run job:expire`), nunca ambos.

## 4. Monitoreo y alertas

- `GET /api/health` → `200 {"status":"ok"|"degraded"}` o `503 {"status":"down"}`. Sin datos internos.
  Con `Authorization: Bearer $CRON_SECRET`: latencia de la base, estado de cada job, emails atrasados (> 15 min),
  emails fallidos en 24 h y avisos de configuración.
- Recomendado (gratis): **UptimeRobot** o **Better Stack** contra `/api/health/live` cada 5 min (no toca la base;
  `/api/health` sí la despierta: consultarlo como mucho cada 30–60 min) (alerta por 503 o por
  la palabra `degraded`). No se configuró: requiere crear una cuenta (autorización del dueño).
- `ALERT_WEBHOOK_URL`: si un job falla 3 veces seguidas se envía un aviso (máx. 1 cada 30 min por job).
- Logs: JSON por línea (`level`, `msg`, `time`, contexto). Un filtro central **redacta** credenciales en URLs,
  `Bearer`, `token=`, claves de Resend, campos llamados `password/secret/token/cookie` y **emails**.

## 5. Backups y restauración

**Estrategia recomendada (sin implementar en producción: requiere acceso al proveedor):**

| Capa | Qué | Retención |
|---|---|---|
| Proveedor gestionado (Neon/Supabase/Railway…) | Backups automáticos + *point-in-time recovery* del plan | Lo que ofrezca el plan (ideal ≥ 7 días PITR) |
| Lógico propio | `scripts/ops/backup.sh` diario (pg_dump formato custom + SHA-256) | 14 diarios locales + copia en bucket con versionado/bloqueo (30 días) |
| Antes de cada migración | `backup.sh` manual | Hasta validar el deploy |

- Usar un rol de **solo lectura** para backups; la URL va en variable de entorno, nunca en el repo ni en logs.
- Cifrado en reposo del bucket y acceso restringido (los dumps contienen datos personales: Ley 25.326).
- **Prueba de restauración mensual** con `scripts/ops/restore-test.sh`: restaura en una base nueva
  `turnup_restore_test_<fecha>` (el script se niega a usar otro nombre), cuenta complejos/reservas/migraciones
  y deja la base para inspección. **Nunca restaurar sobre producción.**
- Verificado localmente: backup de `reservas_dev` (94 KB) → restauración en `turnup_restore_test_…` →
  `tenants=3, bookings=0, migrations=7` → base de prueba eliminada.

## 6. Retención de datos (definida en `RETENTION`, `src/modules/jobs/runner.ts`)

| Dato | Se borra |
|---|---|
| Rate limits | ventanas de más de 24 h |
| Sesiones | 24 h después de vencer |
| Tokens de verificación (reset de contraseña) | 1 h después de vencer |
| Invitaciones vencidas o revocadas (no aceptadas) | a los 30 días |
| Emails enviados u omitidos | a los 90 días |
| Emails fallidos | a los 180 días |
| **Reservas, clientes y auditoría** | **Nunca** (sin política aprobada por el dueño) |

## 7. Imágenes: base de datos → S3/R2

- Abstracción `ObjectStore` (`src/lib/storage/images.ts`): `IMAGE_STORAGE=database` (por defecto) u `object`.
- Las imágenes existentes siguen sirviéndose desde la base; las nuevas se guardan donde indique la variable.
- Toda imagen nueva se **optimiza**: se decodifica de verdad (rechaza archivos corruptos o disfrazados), se
  rota según EXIF, se limita a 1600 px, se convierte a WebP y se le quitan los metadatos (GPS, cámara).
- Migración: `npm run images:migrate` (simulación) / `-- --execute` (sube, verifica SHA-256 y marca la fila).
  **No borra los bytes de la base**: liberar ese espacio es un paso manual posterior a un backup verificado.
  **No se ejecutó** contra ninguna base real.
- R2 de Cloudflare tiene capa gratuita (10 GB); igual requiere cuenta → autorización del dueño.

## 8. App nativa futura

El backend ya es reutilizable: la API pública (`/api/public/...`) es JSON y sin estado de sesión; la autenticación
de Better Auth puede sumar tokens *bearer* (plugin `bearer`, no activado todavía) para una app React Native. Pendiente: versionar la API
(`/api/v1`), documentarla (OpenAPI) y notificaciones push.
