# TURNUP — Gestión y reservas para complejos de fútbol y pádel

Plataforma SaaS multiempresa. Cada complejo tiene:

- **Página pública** (`/padel-centro`): deporte → cancha → fecha → horario con precio real → datos → código y
  **enlace privado** para consultar o cancelar.
- **Panel** (`/panel/padel-centro`): inicio con indicadores, calendario diario/semanal por cancha, reservas
  (filtros, detalle, confirmar, cancelar, reprogramar, notas internas, historial), clientes, canchas y tarifas,
  feriados/días especiales/bloqueos y ajustes.
- **Superadministrador** (`/admin`): complejos, administradores, suspensión y métricas.

**Stack:** Next.js 16 (App Router) · TypeScript estricto · PostgreSQL 16 · Prisma 7 (adapter `pg`) · Better Auth ·
Zod 4 · Luxon · CSS Modules · Vitest · Playwright.

Documentación: [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md) · [`docs/FASE2.md`](docs/FASE2.md) ·
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

## Vencimiento automático de solicitudes

Las solicitudes online `PENDING` vencen a los N minutos (Ajustes, 5 min a 24 h) y liberan el turno.
Tres formas de ejecutar el job (pueden convivir: es idempotente y seguro ante ejecuciones simultáneas):

1. **Programador interno** (por defecto): corre dentro del servidor cada `EXPIRATION_INTERVAL_SECONDS`.
2. **Cron externo por HTTP**: `POST /api/internal/jobs/expire-pending` con `Authorization: Bearer $CRON_SECRET`.
3. **Cron del sistema**: `npm run job:expire`.

Además, cada reserva nueva vence en el momento las pendientes atrasadas, y la base de datos impide confirmar una
vencida aunque el job no haya corrido.

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

## Nuevas migraciones

```bash
npm run db:migrate:new -- --name descripcion
# revisar el SQL: Prisma NO conoce EXCLUDE/triggers/RLS; nunca aceptar DROP de esos objetos.
# Cambios de enum con datos: reescribir a mano con mapeo (ver 20261124000000_courts_schedules_prices).
npm run db:migrate && npm run db:drift
```
