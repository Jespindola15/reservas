# TURNUP en Neon + Netlify — guía de puesta en marcha

Proyecto Neon: `round-haze-78677302` (org `org-misty-cloud-85159751`), rama `production`.
Sitio: el de Netlify que ya existe (no se crea otro ni se cambia la URL).

> Nada de esta guía se ejecutó todavía contra tu Neon ni tu Netlify: no tengo acceso a esas cuentas.
> El procedimiento se ensayó completo en local con los mismos permisos que da Neon (ver §8).

## 0. Compatibilidad Neon ↔ TURNUP (auditoría)

| Requisito de TURNUP | Neon | Adaptación |
|---|---|---|
| PostgreSQL 16+, `btree_gist`, `EXCLUDE`, RLS, triggers, funciones `SECURITY DEFINER`, FKs compuestas | Soportado | Ninguna. `btree_gist` es “trusted”: la instala la propia migración. |
| Roles separados sin `BYPASSRLS` | No hay superusuario. Los roles creados desde la **consola/API** heredan `neon_superuser` (**con BYPASSRLS**) | Los roles de TURNUP se crean **solo por SQL** (`db/bootstrap-neon.sql`), donde nacen sin privilegios. |
| Base con dueño propio | En PG16 el admin necesita poder “actuar como” el dueño | `GRANT reservas_owner TO CURRENT_USER WITH SET TRUE, INHERIT FALSE` (en el bootstrap). |
| Variables de RLS por transacción (`set_config(...,true)`) | Pooler PgBouncer en modo *transaction*: `SET` de sesión no sirve, `set_config` local sí | Ya era así. Probado detrás de PgBouncer en modo transaction. |
| Prepared statements de Prisma | Pooler soporta prepared statements a nivel protocolo | Ninguna. |
| Locks de jobs | `pg_try_advisory_xact_lock` (de transacción) | Funciona con el pooler. |
| **Zona horaria de la sesión** | Por defecto UTC, pero se puede cambiar | **Encontrado en el ensayo**: con otra zona, las fechas se corrían 3 h (vencimientos, emails). Ahora: UTC fijado en base y roles, en cada transacción, y la app **se niega a operar** si detecta otra zona. |
| Migraciones (`prisma migrate deploy`) | Conexión **directa** (host sin `-pooler`) | `MIGRATION_DATABASE_URL` = directa; `DATABASE_URL` (app) = pooled. El proyecto **no usa** `DIRECT_URL`. |
| Scheduler cada minuto | **Plan Free: 100 CU-horas/mes**; la base se suspende tras 5 min sin uso. Un tick por minuto la mantendría despierta 24/7 (≈182 CU-h) y Neon la **suspendería a mitad de mes** | Tick cada **30 min** (≈30 CU-h). La disponibilidad no depende del tick. Monitor externo: usar `/api/health/live` (no toca la base). |
| Driver | Netlify Functions = Node.js con TCP | Se mantiene `@prisma/adapter-pg` (no hace falta el driver serverless de Neon). `DB_POOL_MAX=3`. |

No se desactivó RLS ni ninguna restricción.

## 1. Crear roles y base en Neon (una vez)

1. Neon Console → proyecto → rama **production** → **SQL Editor**, base **neondb**.
2. Generá dos contraseñas largas (32+ caracteres, gestor de contraseñas). No las pegues en el chat.
3. Abrí `db/bootstrap-neon.sql`, reemplazá `REEMPLAZAR_CONTRASENA_OWNER` y `REEMPLAZAR_CONTRASENA_APP`
   **solo en el editor** (no guardes el archivo con las contraseñas) y ejecutalo.
4. La última consulta debe mostrar `rolsuper = f` y `rolbypassrls = f` en los tres roles.
5. **No** crees `reservas_app` desde *Roles* de la consola (tendría BYPASSRLS).

## 2. Obtener las dos cadenas de conexión

Neon Console → **Connect** → rama `production`, base **turnup**:

| Para | Rol | Pooling | Dónde se usa |
|---|---|---|---|
| App (Netlify) | `reservas_app` | **activado** (host con `-pooler`) | `DATABASE_URL` en Netlify |
| Migraciones (tu PC) | `reservas_owner` | **desactivado** | `MIGRATION_DATABASE_URL` solo en tu terminal |

Ambas con `?sslmode=require`. La contraseña es la que elegiste en el paso 1 (la consola no la conoce).

## 3. Respaldo antes de migrar

Neon → **Branches** → `production` → crear una rama de respaldo (p. ej. `backup-antes-de-migrar`).
Si algo sale mal, se puede restaurar desde ahí (o con *Instant restore* del plan).

## 4. Aplicar migraciones (desde tu PC, en la carpeta del proyecto)

```bash
export MIGRATION_DATABASE_URL='postgresql://reservas_owner:...@ep-XXXX.REGION.aws.neon.tech/turnup?sslmode=require'
npm run db:migrate:prod     # muestra destino y estado; pide escribir APLICAR; corre migrate deploy + verificación
```

(En Windows PowerShell: `$env:MIGRATION_DATABASE_URL='...'` y luego `bash scripts/ops/migrate-prod.sh`
desde Git Bash, o `npx prisma migrate deploy` seguido de `npm run db:verify`.)

El script se niega si: la URL es la pooled, el rol no es `reservas_owner` o falta `sslmode`. Nunca ejecuta
`reset`, `push` ni `seed`. Al final, todas las filas de la verificación deben decir **OK**.
Borrá la variable al terminar (`unset MIGRATION_DATABASE_URL`).

## 5. Crear tu superadministrador (desde tu PC)

```bash
export MIGRATION_DATABASE_URL='...la misma de arriba...'
npm run admin:superadmin
```

Te pide email, nombre y contraseña (no se ve al escribir). Repetirlo no duplica nada.
Para cambiar la contraseña más adelante: `npm run admin:superadmin -- --reset-password`.
El seed de demostración **se niega** a correr contra cualquier base que no sea local.

## 6. Variables en Netlify

Netlify → tu sitio → **Site configuration → Environment variables → Add a variable**.
Para las secretas, marcá **Contains secret values**. Contexto de despliegue: **Production**
(así los *deploy previews* no tocan la base real). Si tu plan muestra *Scopes*, dejá **Functions** (y
**Builds** no hace falta: el build usa valores de marcador).

| Variable | Valor / de dónde sale | Secreta |
|---|---|---|
| `DATABASE_URL` | Cadena **pooled** de `reservas_app` (§2) | Sí |
| `BETTER_AUTH_SECRET` | Generala: `openssl rand -base64 32` (o el gestor de contraseñas, 32+ caracteres) | Sí |
| `BETTER_AUTH_URL` | La URL pública exacta del sitio, con `https://` y sin `/` final | No |
| `AUTH_CLIENT_IP_HEADER` | `x-nf-client-connection-ip` | No |
| `CRON_SECRET` | Generala: `openssl rand -hex 32` | Sí |
| `DB_POOL_MAX` | `3` | No |
| `EXPIRATION_SCHEDULER` | `off` (además se apaga solo en Netlify) | No |

**No** cargar en Netlify: `MIGRATION_DATABASE_URL`, `SHADOW_DATABASE_URL`, `SEED_*`, `TRUST_PROXY_HOPS`
(no hace falta con `AUTH_CLIENT_IP_HEADER`), `DIRECT_URL` (el proyecto no la usa). Ninguna variable secreta
lleva el prefijo `NEXT_PUBLIC_`.

Después de cargarlas: **Deploys → Trigger deploy → Deploy site** (las funciones toman las variables al desplegar).

## 7. Comprobar el sitio publicado

1. `https://TU-SITIO/api/health/live` → `{"status":"ok"}` (no toca la base).
2. `https://TU-SITIO/api/health` → `{"status":"ok"}` o `"degraded"` (la primera media hora es normal
   `degraded` hasta que corra el primer tick). `"down"` = revisar variables/base.
3. Detalle (desde tu PC): `curl -H "Authorization: Bearer $CRON_SECRET" https://TU-SITIO/api/health`
   → `db.role` debe ser `reservas_app` y `db.timezone` `UTC`.
4. Ingresar en `https://TU-SITIO/login` con tu superadmin → **/admin**.
5. Netlify → **Logs → Functions → expire-pending**: una línea `tick: 200` cada 30 minutos.

## 8. Ensayo realizado (local, con permisos tipo Neon)

Servidor PostgreSQL 16 aparte, con un administrador **sin superusuario** (CREATEROLE + CREATEDB, como el de
Neon) y PgBouncer 1.22 en modo *transaction* con prepared statements (como el pooler de Neon):

- `bootstrap-neon.sql` → roles sin BYPASSRLS, base `turnup`, UTC. Segunda ejecución: idempotente
  (solo avisa que la base ya existe). Primer intento falló por la regla de PG16 → corregido.
- `migrate-prod.sh` → 7 migraciones aplicadas, verificación 12/12 OK; rechazó URL pooled, rol equivocado y
  confirmación incorrecta.
- `create-superadmin` → creado; repetido sin cambios; contraseña corta/no coincidente rechazadas; hash scrypt.
- Suite Vitest completa (159) **a través de PgBouncer** con esos roles: todo aprobado (incluye concurrencia,
  antisolapamiento, RLS y aislamiento). Antes de fijar UTC fallaban 7: así se detectó el problema de zona horaria.
- Build de producción contra esa base: login real del superadmin en el navegador, `/admin`, tick, reinicio del
  servidor y la sesión/datos siguieron. Con un rol con BYPASSRLS o con el rol dueño, la app respondió
  `down` y no operó (falla cerrada).

## 9. Futuros despliegues

- Push a la rama de siempre → Netlify despliega. El build **no** migra, **no** crea usuarios y **no** corre seeds.
- Si un cambio trae migraciones nuevas: rama de respaldo en Neon → `npm run db:migrate:prod` → **después** push.
  Las migraciones se escriben aditivas (el código anterior sigue funcionando con el esquema nuevo).
- Para pruebas destructivas en Neon: crear una rama aparte (p. ej. `test`) y apuntar `.env.test` a una base
  `reservas_test` en ESA rama. Nunca a `production`.

## 10. Configuración realizada en producción (24/11/2026)

Sin valores secretos. Todo verificado contra los servicios reales.

**Neon** (proyecto `turnup` / `round-haze-78677302`, PostgreSQL 18.7, AWS us-east-2, plan Free)
- Rama `production` (`br-twilight-pond-bdxq5izs`), endpoint `ep-dawn-butterfly-bd5adobx` (directo y `-pooler`).
- Roles `app_runtime`, `reservas_owner`, `reservas_app`: sin superusuario, sin BYPASSRLS, sin CREATEROLE/CREATEDB.
  Contraseñas de `reservas_owner` y `reservas_app` **rotadas** con valores aleatorios de 40 caracteres generados
  localmente (no se guardaron en ningún archivo del proyecto).
- `neondb_owner` recibió `reservas_owner` con `SET TRUE, INHERIT FALSE` (requisito de PG16+ para crear la base).
- Base `turnup` (dueña `reservas_owner`), `CONNECT` solo para `reservas_app`, `TimeZone=UTC` en base y roles.
- Rama de respaldo previa a migrar: `backup-antes-de-migrar-20261124` (`br-quiet-darkness-bdr7vtxz`), sin cómputo.
- 7 migraciones aplicadas con `scripts/ops/migrate-prod.sh`; `db/verify.sql` 12/12 OK; `prisma migrate diff`: sin diferencias.
- Comprobado con `reservas_app` por el pooler: UTC, sin BYPASSRLS, 0 complejos visibles sin contexto,
  escritura directa en `court_allocations` y `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` rechazadas (42501).
- Superadministrador creado con `scripts/ops/create-superadmin.ts` (hash scrypt de Better Auth; queda en auditoría).
- La API key temporal de Neon fue **revocada** al terminar.
- **Data API** de Neon (sobre `neondb`, sin uso en TURNUP): **desactivada** el 24/11/2026.

**Netlify** (sitio `turn-up-sn`, `https://turn-up-sn.netlify.app`, repo `Jespindola15/reservas`, rama `main`)
- Variables (contexto **Production**): `DATABASE_URL`*, `BETTER_AUTH_SECRET`*, `CRON_SECRET`* (*secretas, ámbitos
  builds/functions/runtime), `BETTER_AUTH_URL`, `AUTH_CLIENT_IP_HEADER`, `DB_POOL_MAX`, `EXPIRATION_SCHEDULER`.
- `BETTER_AUTH_SECRET` y `CRON_SECRET` generados localmente (32 bytes aleatorios). Netlify no permite volver a
  leer los valores secretos: para usar `/api/health` detallado hay que generar y cargar un `CRON_SECRET` nuevo.
- Credenciales de migración **no** están en Netlify.

**Verificado en el sitio publicado**: `/api/health` → `ok` (base a ~30 ms), tick protegido (401 sin secreto,
200 con secreto), login del superadmin (401 con contraseña incorrecta, 200 correcta, cookie HttpOnly/Secure/SameSite),
`/admin`, `/admin/planes`, `/admin/auditoria` accesibles, cierre de sesión efectivo, datos creados desde fuera
leídos por las funciones serverless (persistencia).

**Próximas migraciones**: la contraseña de `reservas_owner` no se guardó. Para migrar en el futuro, en el SQL Editor
de Neon (base `neondb`): `ALTER ROLE reservas_owner PASSWORD '<nueva, 32+ caracteres>';`, armar la URL directa y
seguir §4. Antes, crear otra rama de respaldo.

### Verificación de aislamiento en producción (24/11/2026)
Con autorización del dueño se crearon dos complejos temporales (`zz-prueba-aislamiento-a/b`), dos dueños
`@turnup-prueba.invalid` y una reserva en cada uno, por la API pública real. 21/21 controles OK: cada dueño solo
ve, lista y exporta lo suyo; 404 en paneles ajenos y en `/admin`; 403 al exportar datos ajenos; reservar una
cancha de otro complejo → 404; doble turno en la misma cancha → 409; el mismo horario en complejos distintos no
choca. Luego se borraron **solo** esas filas (simulación previa con rollback; ninguna otra tabla afectada).

### Consumo de planes gratuitos (estimación)
- **Neon Free** (100 CU-h/mes por proyecto, compute 0,25–2 CU, se suspende a los 5 min): la tarea cada 30 min
  despierta la base ~48 veces/día ≈ 4 h activas ≈ **30 CU-h/mes** de base. Quedan ~70 CU-h ≈ 280 h activas a
  0,25 CU. Con uso comercial diario (p. ej. 12 h/día activas) se supera el plan: pasar a Launch o bajar el máximo de CU.
- **Netlify Free clásico** (cuota compartida por TODOS los sitios de la cuenta): 125.000 invocaciones de
  funciones/mes, 100 GB-h de funciones, 100 GB de ancho de banda, 300 min de build. Cada página o llamada a la API
  de TURNUP es una invocación (todas son dinámicas); la tarea programada suma ~2.900/mes.
