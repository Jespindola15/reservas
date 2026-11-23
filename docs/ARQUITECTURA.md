# Arquitectura TURNUP (Fases 1 y 2)

## Capas

```
src/
  app/                       Rutas Next.js (UI + Route Handlers + Server Actions). Sin lógica de negocio.
    [slug]/                  Página pública del complejo (plataforma.com/padel-centro)
    panel/[slug]/            Panel del dueño (requiere membresía)
    admin/                   Superadministrador (requiere platformRole = SUPERADMIN)
    api/auth/[...all]        Better Auth
    api/public/[slug]/...    Disponibilidad y solicitud de reserva (públicas, con rate limit)
  modules/                   Dominio, sin dependencias de Next.js (testeable con Vitest)
    booking/                 Motor de reservas: tiempo, precios, servicio, disponibilidad
    access/                  Autorización: membresías y matriz de permisos
    tenant/                  Resolución pública de complejos
    platform/                Operaciones del superadmin (auditadas)
  lib/
    db/                      Prisma (rol app), contexto de tenant (RLS), clasificación de errores PG
    auth/                    Better Auth (servidor), DAL (sesión + autorización), cliente
    security/                Rate limiting en PostgreSQL, IP de cliente
    errors.ts, audit.ts      Errores públicos controlados, auditoría transaccional
prisma/
  schema.prisma              Modelo de datos
  migrations/                SQL real (incluye EXCLUDE, triggers, CHECK, RLS, GRANT)
db/bootstrap.sql             Roles de PostgreSQL (una vez por servidor, como superusuario)
```

## Aislamiento multiempresa (defensa en profundidad)

1. **El tenant nunca viene del navegador.** Se resuelve en el servidor desde el *slug* de la URL
   (`app_resolve_tenant_slug`, función `SECURITY DEFINER` que solo devuelve id y estado) y, en
   el panel, se exige además una **membresía** del usuario autenticado con un rol que tenga el
   permiso pedido (`modules/access/authorize.ts`). Solo esa capa construye un `TenantContext`.
2. **Filtro explícito por `tenantId`** en todos los servicios (`where: { id, tenantId }`).
3. **Claves foráneas compuestas** `(tenant_id, court_id) → courts(tenant_id, id)` y lo mismo para
   clientes: la base rechaza una reserva del complejo A sobre una cancha del complejo B, aun con SQL directo.
4. **Row Level Security** (ver abajo): si un desarrollador olvida el filtro, la base no devuelve
   ni modifica filas de otro complejo.

### Cómo está implementado RLS

- Dos roles: `reservas_owner` (dueño del esquema; corre migraciones y seed) y `reservas_app`
  (lo usa la app; **no** es dueño de las tablas y es `NOBYPASSRLS`, por lo que RLS siempre aplica).
  Los permisos se otorgan a un rol de grupo `app_runtime`.
- Cada operación de negocio corre en una transacción que fija variables de sesión **locales a la
  transacción** (`set_config('app.tenant_id', …, true)`), por lo que no se filtran a otra petición
  que reutilice la conexión del pool (hay prueba de esto).
- Políticas: `tenant_id = app_current_tenant_id() OR app_is_platform_admin()` en `USING` y `WITH CHECK`
  para canchas, horarios, precios, clientes, reservas, bloqueos, ocupaciones y suscripciones.
  Sin contexto, el rol de la app ve **cero** filas (falla cerrada).
- `tenants`: lectura para su propio contexto, para miembros (`memberships.user_id = app.user_id`) y
  para superadmin; alta/baja solo superadmin.
- `memberships`, `plans`: escritura solo superadmin.
- `court_allocations`: el rol de la app solo tiene `SELECT`; la escriben triggers `SECURITY DEFINER`.
- `audit_logs`: solo `SELECT` e `INSERT` para la app (no puede alterar la historia).

**Límite honesto de RLS aquí:** las variables `app.*` las fija la propia aplicación. RLS protege
contra *errores de programación* (consultas sin filtro), no contra alguien que logre ejecutar SQL
arbitrario con el rol de la app (podría fijar `app.platform_admin`). Mitigaciones: Prisma
parametriza todas las consultas, no hay SQL dinámico con datos del usuario y la cuenta de la app no
tiene privilegios de DDL. Mejora futura: un rol de BD separado para operaciones de plataforma.

## Motor de reservas

- Tiempos en `timestamptz` (UTC). Horarios configurados en **hora local del complejo** (zona IANA),
  en minutos desde la medianoche del *día operativo*; `close_minute` puede superar 1440 para franjas
  que cruzan medianoche (18:00–02:00 = 1080–1560). Los turnos de madrugada pertenecen al día anterior.
- Turnos sobre una grilla local (`slot_step_minutes`); duración en tiempo real (correcto ante cambios
  de horario de verano; horas locales inexistentes no generan turnos).
- Intervalos semiabiertos `[inicio, fin)`: 20:00–21:30 y 21:30–23:00 no se solapan.
- **Última barrera:** la tabla `court_allocations` (una fila por reserva activa o bloqueo, mantenida
  por triggers) tiene `EXCLUDE USING gist (court_id WITH =, period WITH &&)`. Así reservas y bloqueos
  compiten en la **misma** restricción (una restricción de exclusión no puede abarcar dos tablas).
  Con 100 solicitudes simultáneas, PostgreSQL confirma exactamente una; las demás reciben `23P01`,
  que la app traduce a `SLOT_UNAVAILABLE` (409) sin exponer detalles internos.
- Estados: `PENDING` y `CONFIRMED` ocupan; `CANCELLED`/`REJECTED` liberan; `COMPLETED`/`NO_SHOW`
  siguen ocupando (historia). Transiciones explícitas + *optimistic locking* (`version`).
- Reprogramación atómica: el trigger borra y recrea la ocupación en la misma transacción; si choca,
  se revierte todo.
- Idempotencia: `(tenant_id, idempotency_key)` único + huella SHA-256 del pedido. Repetir devuelve
  la misma reserva; reusar la clave con otros datos se rechaza; envíos concurrentes con la misma
  clave generan una sola reserva.
- Precio congelado en la reserva (centavos, entero). Regla más específica gana.
- Reservas manuales y online usan el **mismo** `createBooking`; solo cambian estado inicial y
  anticipación mínima.

## Preparado para Mercado Pago (no implementado)

- Cada complejo tendrá su propia conexión OAuth (credenciales cifradas por tenant, fuera del alcance de la Fase 1).
- Un pago se asociará a una reserva existente; nunca creará ocupación por sí mismo. Si un pago llega
  tarde y el turno ya no está, la restricción de exclusión impide la doble reserva y el pago va a
  conciliación/reembolso.
- Webhooks: verificación de firma + tabla de eventos procesados con id único (idempotencia).
- Hoy **no existe** ningún estado "pagado" ni pago simulado.

## Por qué `cacheComponents` está desactivado

Next.js 16 activa *Cache Components* en proyectos nuevos. En esta fase casi todas las vistas dependen
del tenant y de la sesión; una clave de caché mal definida podría servir datos de un complejo a
otro. Se usa renderizado dinámico explícito y se evaluará cachear la página pública (con claves por
tenant revisadas) en una fase posterior.

## Fase 2: piezas nuevas

### Horarios, excepciones y precios
- Disponibilidad de un día operativo = feriado/cierre (`CLOSED`) › horario especial (`SPECIAL_HOURS`, reemplaza
  el semanal) › horario semanal de la cancha. Las excepciones del complejo (`court_id NULL`) aplican a todas las
  canchas. La misma función (`windowsForDate`) la usan la disponibilidad pública, la validación de reservas
  (online, manuales y reprogramaciones), el calendario y el dashboard: no hay dos reglas distintas.
- Precio: fecha especial › día + franja › franja › día › general › precio base prorrateado. El importe se congela
  en la reserva; cambiar tarifas no altera reservas existentes.

### Vencimiento de solicitudes PENDING
- Reglas explícitas: solo `PENDING` vence (CHECK `bookings_pending_has_expiry`); `CONFIRMED` y las manuales no.
  Al confirmar se borra `expires_at`.
- `app_expire_pending_bookings(batch, tenant?)` (SECURITY DEFINER): `FOR UPDATE SKIP LOCKED` + re-chequeo de
  estado ⇒ ejecuciones simultáneas sin doble procesamiento e idempotencia; libera la ocupación vía trigger y
  audita cada vencimiento en la misma sentencia.
- Trigger `bookings_guard_status`: una PENDING vencida no puede pasar a CONFIRMED/jugada ni moverse, y los
  estados finales no se reabren, aunque el job todavía no haya corrido o alguien use SQL directo.
- Al crear/reprogramar se vencen primero las atrasadas del complejo, y la disponibilidad ignora PENDING vencidas.

### Acceso público a la reserva
- Código de 8 caracteres = identificador, no credencial. Ver/cancelar exige `token = HMAC-SHA256(secreto,
  bookingId)` (256 bits, comparación en tiempo constante). Mismo error para código inexistente o token inválido.
  Sin almacenamiento de tokens. La vista muestra solo nombre de pila. Rate limit por IP, `noindex`, sin
  recursos de terceros (el token no se filtra por Referer).

### Imágenes
- Guardadas en `court_images` (bytea, ≤ 1,5 MB, máx. 6 por cancha) tras verificar la firma de bytes; se sirven con
  `nosniff`, `CSP: default-src 'none'; sandbox`. Futuro: almacenamiento de objetos.

### Interfaz
- Las Server Actions re-autorizan siempre (`requireTenant` con permiso específico). Los layouts solo presentan.
- Acciones de estado redirigen con un aviso de lista blanca (`?ok=`) para que el resultado sobreviva al refresco.
- La reserva manual genera la clave de idempotencia en el servidor y la rota en el cliente tras cada éxito.
