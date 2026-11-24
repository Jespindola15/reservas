# TURNUP — Gestión y reservas para complejos de fútbol y pádel

Plataforma SaaS multiempresa. Cada complejo tiene:

- **Página pública** (`/padel-centro`): deporte → cancha → fecha → horario con precio real → datos → código y
  **enlace privado** para consultar o cancelar.
- **Panel** (`/panel/padel-centro`): inicio con indicadores, calendario diario/semanal por cancha, reservas
  (filtros, detalle, confirmar, cancelar, reprogramar, notas internas, historial), clientes, canchas y tarifas,
  feriados/días especiales/bloqueos y ajustes.
- **Equipo** (`/panel/<slug>/equipo`): invitaciones por email, roles, desactivación de accesos.
- **Superadministrador** (`/admin`): complejos, administradores, suspensión, métricas, **planes y límites**
  (`/admin/planes`) y **visor de auditoría** con filtros (`/admin/auditoria`).
- **Emails automáticos** (cola persistente/outbox) para jugadores y dueños; **recuperación de contraseña**.
- **PWA instalable** (Android/iPhone) sin caché de datos privados ni de disponibilidad.

**Stack:** Next.js 16 (App Router) · TypeScript estricto · PostgreSQL 16 · Prisma 7 (adapter `pg`) · Better Auth ·
Zod 4 · Luxon · CSS Modules · Vitest · Playwright.

Documentación: [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md) · [`docs/FASE2.md`](docs/FASE2.md) ·
[`docs/FASE3.md`](docs/FASE3.md) · [`docs/INFRAESTRUCTURA.md`](docs/INFRAESTRUCTURA.md) ·
[`docs/PENDIENTES_Y_RIESGOS.md`](docs/PENDIENTES_Y_RIESGOS.md).

> **No está listo para producción** sin una revisión de seguridad externa y los pendientes de
> `docs/PENDIENTES_Y_RIESGOS.md`. No hay pagos: los importes son informativos.

## Requisitos

- Node.js 22+
- PostgreSQL 14+ con `btree_gist` (paquete `postgresql-contrib`).
- Acceso de superusuario a PostgreSQL **una vez** para crear los roles.

## Puesta en marcha (desarrollo)

```bash
npm install                                   # también genera el cliente Prisma

# Roles (una vez por servidor). Elegí tus contraseñas:
psql -U postgres -v owner_pw="'CLAVE_OWNER'" -v app_pw="'CLAVE_APP'" -f db/bootstrap.sql

# Bases (dueño: reservas_owner)
createdb -U postgres -O reservas_owner reservas_dev
createdb -U postgres -O reservas_owner reservas_shadow   # solo para `migrate dev`
createdb -U postgres -O reservas_owner reservas_test     # integración
createdb -U postgres -O reservas_owner reservas_e2e      # E2E

cp .env.example .env              # completar contraseñas y BETTER_AUTH_SECRET (openssl rand -base64 32)
cp .env.test.example .env.test

npm run db:migrate                # aplica TODAS las migraciones (Fase 1 + Fase 2)
npm run db:seed                   # complejos y usuarios de ejemplo
npm run dev                       # http://localhost:3000/padel-centro
```

Usuarios del seed: `superadmin@example.com`, `duenio@padel-centro.example.com`,
`duenio@futbol-norte.example.com`, `staff@futbol-norte.example.com`.

> Los nombres técnicos (bases `reservas_*`, roles `reservas_owner`/`reservas_app`, prefijo de cookies) se
> mantienen a propósito: cambiarlos rompería instalaciones existentes o cerraría todas las sesiones.

## Tareas programadas (vencimientos, emails, limpieza)

Una sola tarea, `POST /api/internal/jobs/tick` (`Authorization: Bearer $CRON_SECRET`), hace en orden:
vencer solicitudes `PENDING` atrasadas → programar recordatorios y resúmenes → enviar la cola de emails →
limpieza horaria (rate limits, sesiones y tokens vencidos, invitaciones cerradas, emails viejos). Cada paso es
idempotente y seguro ante ejecuciones simultáneas (`FOR UPDATE SKIP LOCKED`, locks de PostgreSQL).

**Un solo scheduler** según el hosting:

- **Netlify (actual)**: la función programada `netlify/functions/expire-pending.mts` llama al tick cada minuto.
  El temporizador interno se apaga solo en serverless.
- **Servidor persistente** (`next start` en un VPS): `EXPIRATION_SCHEDULER=internal` (por defecto), o un cron
  del sistema con `npm run job:expire`.

Estado: `GET /api/health` (público: `{status}`; con el secreto: base de datos, jobs, cola de emails, avisos).

## Verificación

```bash
npm run typecheck          # TypeScript estricto
npm run lint               # ESLint
npm run test               # Vitest: unitarias + integración contra PostgreSQL real (reservas_test)
npm run test:e2e           # build de producción + Playwright (reservas_e2e). Requiere: npx playwright install chromium
npm run db:drift           # esquema Prisma y base alineados (incluye EXCLUDE, triggers y RLS)
npm run check              # todo lo anterior
```

## Producción (lineamientos)

- `DATABASE_URL` con el rol **reservas_app** (la app se niega a arrancar con el rol dueño).
- `BETTER_AUTH_URL` con `https://`; `BETTER_AUTH_SECRET` propio y largo (también firma los enlaces de seguimiento:
  rotarlo invalida los enlaces emitidos).
- **Obligatorio detrás de un proxy:** `AUTH_CLIENT_IP_HEADER` (cabecera que el proxy sobrescribe, p. ej. `x-real-ip`).
  Es la única fuente de IP para rate limiting de login y de reservas. Sin ella, el límite es global.
- `CRON_SECRET` (≥ 32 caracteres) si se usa el cron por HTTP; `EXPIRATION_SCHEDULER=off` si solo hay cron externo.
- Migraciones con `prisma migrate deploy` usando `MIGRATION_DATABASE_URL`.
- Varias instancias: `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` igual en todas.

## Deploy en Netlify

La instalación y el build funcionan sin secretos (`prisma generate` no necesita la base; el build usa
marcadores). Pero **la app no funciona en runtime sin una base PostgreSQL accesible desde internet** (Neon,
Supabase, Railway, etc.) y estas variables en *Site configuration → Environment variables*:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | URL del rol **reservas_app** (con `?sslmode=require` si el proveedor lo pide) |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | `https://TU-SITIO.netlify.app` (o tu dominio) |
| `AUTH_CLIENT_IP_HEADER` | `x-nf-client-connection-ip` (cabecera que pone Netlify) |
| `CRON_SECRET` | ≥ 32 caracteres (lo usa la función programada de vencimientos) |
| `EXPIRATION_SCHEDULER` | `off` (en serverless el temporizador en memoria no sirve; vence la función programada) |
| `EMAIL_PROVIDER` | vacío = emails desactivados. `resend` solo después de verificar el dominio en Resend |
| `RESEND_API_KEY`, `EMAIL_FROM` | solo si `EMAIL_PROVIDER=resend` |
| `ALERT_WEBHOOK_URL` | opcional: webhook que recibe fallas repetidas de jobs |
| `IMAGE_STORAGE`, `S3_*` | opcional: `object` + credenciales de R2/S3 (por defecto `database`) |

Preparar la base **una vez, desde tu máquina** (no desde Netlify):

```bash
psql "URL_ADMIN_DEL_PROVEEDOR" -v owner_pw="'...'" -v app_pw="'...'" -f db/bootstrap.sql
# crear la base con dueño reservas_owner (o usar la del proveedor y transferirla), luego:
MIGRATION_DATABASE_URL="postgresql://reservas_owner:...@HOST/DB?sslmode=require" npx prisma migrate deploy
```

- `netlify.toml` fija Node 22 y `npm run build`.
- `netlify/functions/expire-pending.mts` es una función programada que cada minuto dispara el tick.
- **Las migraciones NO corren en el build.** Después de cada deploy que agregue migraciones hay que ejecutar
  `prisma migrate deploy` contra la base de producción (son aditivas; ver docs/INFRAESTRUCTURA.md).
- Si el proveedor no permite crear roles (`CREATE ROLE`) o la extensión `btree_gist`, no sirve: la app depende de
  ambos para el aislamiento (RLS) y la protección antisolapamiento.

## Nuevas migraciones

```bash
npm run db:migrate:new -- --name descripcion
# revisar el SQL: Prisma NO conoce EXCLUDE/triggers/RLS; nunca aceptar DROP de esos objetos.
# Cambios de enum con datos: reescribir a mano con mapeo (ver 20261124000000_courts_schedules_prices).
npm run db:migrate && npm run db:drift
```
