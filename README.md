# Reservas — SaaS de turnos de fútbol y pádel (Fase 1)

Plataforma multiempresa: cada complejo tiene su página pública (`/padel-centro`) y su panel
(`/panel/padel-centro`); el superadministrador gestiona todo desde `/admin`.

**Stack:** Next.js 16 (App Router) · TypeScript estricto · PostgreSQL 16 · Prisma 7 (adapter `pg`) ·
Better Auth · Zod 4 · Luxon · CSS Modules · Vitest · Playwright.

Diseño detallado: [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md).

## Requisitos

- Node.js 22+
- PostgreSQL 14+ con la extensión `btree_gist` (viene con el paquete `postgresql-contrib`).
- Acceso de superusuario a PostgreSQL **una sola vez** para crear los roles.

## Puesta en marcha (desarrollo)

```bash
# 1. Dependencias (genera también el cliente Prisma)
npm install

# 2. Roles de PostgreSQL (una vez por servidor). Elegí tus contraseñas:
psql -U postgres -v owner_pw="'CLAVE_OWNER'" -v app_pw="'CLAVE_APP'" -f db/bootstrap.sql

# 3. Bases de datos (dueño: reservas_owner)
createdb -U postgres -O reservas_owner reservas_dev
createdb -U postgres -O reservas_owner reservas_shadow   # solo para `migrate dev`
createdb -U postgres -O reservas_owner reservas_test     # pruebas de integración
createdb -U postgres -O reservas_owner reservas_e2e      # pruebas E2E

# 4. Variables de entorno
cp .env.example .env              # completar contraseñas y BETTER_AUTH_SECRET (openssl rand -base64 32)
cp .env.test.example .env.test    # completar contraseñas

# 5. Migraciones + datos de ejemplo
npm run db:migrate
npm run db:seed                   # imprime contraseñas generadas si no definiste SEED_*_PASSWORD

# 6. Levantar
npm run dev                       # http://localhost:3000/padel-centro
```

Usuarios del seed: `superadmin@example.com`, `duenio@padel-centro.example.com`,
`duenio@futbol-norte.example.com`, `staff@futbol-norte.example.com`.

## Verificación

```bash
npm run typecheck          # TypeScript estricto
npm run lint               # ESLint
npm run test               # Vitest: unitarias + integración contra PostgreSQL real (reservas_test)
npm run test:e2e           # build de producción + Playwright (reservas_e2e). Requiere: npx playwright install chromium
npm run db:drift           # verifica que el esquema Prisma y la base estén alineados
npm run check              # todo lo anterior
```

Las credenciales de `playwright.config.ts` son solo para la base local `reservas_e2e`; adaptalas a tu entorno.

## Producción (lineamientos)

- `DATABASE_URL` debe usar el rol **reservas_app** (la app se niega a arrancar si detecta el rol dueño).
- `BETTER_AUTH_URL` con `https://`; `BETTER_AUTH_SECRET` propio y largo; ambos en el gestor de secretos.
- Detrás de un proxy: `TRUST_PROXY_HOPS` y `AUTH_CLIENT_IP_HEADER` (una cabecera que el proxy **sobrescribe**).
- Migraciones en el despliegue con `prisma migrate deploy` usando `MIGRATION_DATABASE_URL` (rol dueño).
- Varias instancias: definir `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` igual en todas.
- El seed se niega a correr con `NODE_ENV=production`.

## Flujo para nuevas migraciones

```bash
npm run db:migrate:new -- --name descripcion   # genera SQL sin aplicarlo
# revisar el SQL: Prisma NO conoce EXCLUDE/triggers/RLS; nunca aceptar un DROP de esos objetos
npm run db:migrate && npm run db:drift
```
