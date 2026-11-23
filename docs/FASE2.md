# TURNUP — Fase 2: resumen de cambios

## Funcionalidades

| Bloque | Implementado |
|---|---|
| A. Canchas, horarios, precios | Alta/edición/desactivación de canchas (Fútbol 5/7/11, Pádel), descripción, capacidad, duraciones 60/90/120, intervalo de inicio, precio base, imágenes (JPG/PNG/WebP ≤ 1,5 MB, tipo verificado por firma), borrado físico solo sin historial. Horario semanal por cancha (cruza medianoche, "aplicar a todas"). Feriados/cierres y días con horario especial (complejo o cancha). Tarifas por duración, día, franja, fin de semana y fecha especial, con precio base de respaldo. |
| B. Calendario y reservas | Vista diaria con columnas por cancha (estados por color, bloqueos, celdas libres que abren la carga manual prellenada) y semanal con filtro de cancha. Listado con filtros (estado, cancha, fechas, texto) y paginación. Detalle con datos del jugador, confirmar/rechazar/cancelar/jugada/ausente, reprogramar (misma restricción de PostgreSQL), notas internas e historial desde auditoría. Modales de confirmación. |
| C. Vencimiento y seguridad | Estado `EXPIRED`, `expires_at` obligatorio en `PENDING` (CHECK), plazo configurable 5 min–24 h, nunca después del inicio. Job en PostgreSQL con `FOR UPDATE SKIP LOCKED`, idempotente y auditado (`SYSTEM`). Trigger que impide confirmar/reprogramar una vencida y reabrir estados finales. Programador interno + endpoint con secreto + CLI. Liberación inmediata al reservar y en la disponibilidad. |
| D. Público y clientes | Flujo deporte → cancha (con foto) → fecha → duración → horario con precio → datos. Código + enlace privado con token HMAC de 256 bits (el código solo no da acceso). Página de seguimiento sin datos personales, cancelación dentro del plazo configurable. Sección de clientes: búsqueda (nombre, email, teléfono por dígitos), historial, cancelaciones/ausencias, observaciones. |
| E. Dashboard y diseño | Identidad TURNUP (negro/azul oscuro, verde lima, blanco), barra lateral (menú desplegable en celular), inicio con turnos del día, pendientes, vencidas, ocupación por cancha, próximos turnos, actividad y accesos rápidos. Sin ingresos inventados. |

## Errores críticos corregidos de la Fase 1

- **Ingresos inventados**: el panel mostraba "Facturación estimada" de reservas no cobradas → eliminado.
- **PENDING eternas** retenían turnos indefinidamente → vencimiento (bloque C).
- **Dos fuentes de IP** (login vs reservas): configurar el proxy para una dejaba la otra con cupo global → unificadas
  en `getClientIp` + `AUTH_CLIENT_IP_HEADER`.
- **Consultas en paralelo dentro de una transacción** (`Promise.all` sobre la conexión de la transacción) →
  secuenciales.
- Pruebas unitarias dependían del orden de carga del entorno → setup propio.

## Migraciones nuevas (las de Fase 1 no se modificaron)

| Migración | Contenido |
|---|---|
| `20261124000000_courts_schedules_prices` | Enum de deportes (mapea `FOOTBALL → FOOTBALL_5` sin perder filas; el SQL autogenerado por Prisma fallaba con datos), capacidad, precio base, `schedule_exceptions`, `court_images`, `special_date` en tarifas, plazos del complejo, CHECKs, RLS y permisos. |
| `20261124000100_booking_status_expired` | Valor `EXPIRED` (sola: un valor de enum debe confirmarse antes de usarse). |
| `20261124000200_pending_expiration` | `expires_at`, `expired_at`, `internal_notes`, índice, CHECK de PENDING con vencimiento, trigger de guardia de estados, función `app_expire_pending_bookings`. |

## Archivos principales

- Dominio: `src/modules/courts/service.ts`, `src/modules/tenant/settings.ts`, `src/modules/booking/{admin-queries,public-access,time,pricing,service,availability}.ts`, `src/modules/customers/service.ts`, `src/modules/dashboard/queries.ts`, `src/modules/jobs/{expire-pending,scheduler}.ts`.
- Rutas: `src/app/panel/[slug]/{layout,page,calendario,reservas,clientes,canchas,horarios,ajustes}`, `src/app/[slug]/{page,BookingWidget,reserva/[code]}`, `src/app/api/internal/jobs/expire-pending`, `src/app/api/public/[slug]/courts/[courtId]/images/[imageId]`, `src/instrumentation.ts`, `scripts/expire-pending.ts`.
- UI: `src/app/globals.css`, `src/components/{ui.module.css,ActionForm,Brand,TopBar}.tsx`.
- Pruebas: `tests/integration/{courts-admin,booking-admin,expiration,public-and-customers}.test.ts`, `tests/unit/client-ip.test.ts`, `tests/e2e/flows.spec.ts`.
- Eliminado: `src/app/panel/[slug]/panel.module.css` (vista del día de la Fase 1, reemplazada por el calendario).

## Resultados de pruebas (ejecutadas, 23/11/2026)

| Verificación | Resultado |
|---|---|
| TypeScript estricto | sin errores |
| ESLint | sin errores ni advertencias |
| Deriva esquema ↔ base | ninguna |
| Vitest | **117/117** (9 archivos: 17 unitarias, 100 de integración contra PostgreSQL real) |
| `next build` producción | correcto |
| Playwright (build de producción, escritorio + celular) | **15/15** |

Cobertura pedida: creación/edición de canchas, cambios de horario, tarifas por día y hora, precio histórico,
reservas fuera de horario/feriados, simultáneas (2, 10, 100 y admins concurrentes), vencimiento (8 jobs
concurrentes sobre 60 vencidas, idempotencia, aislamiento por complejo), confirmación de vencidas (app, base y
carrera con el job), cancelaciones, reprogramaciones (concurrentes y sobre bloqueos), bloqueos, aislamiento entre
complejos, accesos sin permisos (STAFF, otro complejo, superadmin), flujos completos de jugador y administrador.
