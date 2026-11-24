# Fase 3.1 — Optimización integral y preparación comercial

Estado: implementada por bloques (un commit por bloque). Producción **sin cambios** hasta aplicar las
migraciones en Neon (primero en una rama aislada y con respaldo previo) y hacer push.

| Bloque | Qué incluye |
|---|---|
| 1 · Seguridad | 2FA (TOTP + códigos de respaldo) obligatorio para el superadmin; límite de login por IP más alto (30/15 min) para que el personal en la misma red no se bloquee, manteniendo el límite por cuenta; límites en endpoints 2FA; anti-reservas falsas (campo trampa + máx. 4 reservas online activas por contacto). |
| 2 · Reservas | Turnos fijos semanales con fecha de fin (vista previa de conflictos, sin duplicados, cancelar serie desde una fecha); pagos/señas/devoluciones manuales con saldo; historial; WhatsApp. Sin datos de tarjetas. |
| 3 · Calendario | Filtros por deporte/estado, línea de hora actual, reprogramar arrastrando (mouse o mantener presionado en celular), siempre validado en el servidor. |
| 4 · Estadísticas y clientes | Cobrado vs. proyectado, pendiente, ocupación, cancelaciones, clientes nuevos/recurrentes, horas y días pico, comparación con el período anterior; clientes con visitas, total abonado, filtros, duplicados y CSV. |
| 5 · Página pública | Portada con listado de complejos; logo, portada, galería, color de marca, redes, servicios, precios "desde", política de cancelación, compartir partido; QR descargable; puesta en marcha en 7 pasos. |
| 6 · Plataforma y operación | Superadmin: complejos activos/suspendidos/en prueba, vencimientos, MRR registrado, cobrado 30 días, usuarios activos, actividad por complejo, estado del sistema (tamaño de base vs. plan gratuito, tareas, email); registro manual de pagos de suscripción (listo para conciliar Mercado Pago más adelante, sin integrarlo). Email de bienvenida para dueños nuevos. Respaldo semanal cifrado (age) fuera de Neon vía GitHub Actions + prueba de restauración aislada. Entorno demo con datos ficticios y barreras anti-producción. Borradores legales (`docs/legal/`). |

## Migraciones nuevas (aditivas, sin DROP)

- `20261126000000_phase31_payments_series_branding_2fa`: `two_factors`, `booking_payments`, `booking_series`,
  `tenant_assets`, `subscription_payments`, columnas de marca/onboarding en `tenants`, `bookings.series_id`.
  RLS por complejo en las tablas nuevas; CHECKs equivalentes a las validaciones de la app.
- `20261127000000_public_directory`: `tenants.public_listed` (default true) y función `app_public_directory`
  (SECURITY DEFINER, solo datos públicos; EXECUTE solo para `app_runtime`).

## Pendiente / requiere al dueño

- Revisar los borradores legales con un abogado/a (no son definitivos).
- Activar el respaldo semanal: cargar los secretos `BACKUP_DATABASE_URL` (rol de solo lectura) y
  `BACKUP_AGE_RECIPIENT` en GitHub, y guardar la clave privada age.
- Activar 2FA del superadmin en el primer ingreso tras el deploy (app de autenticación).
- Notificaciones push: no implementadas (requieren claves VAPID y permiso explícito de cada usuario).
- Dominio propio y emails reales (Resend) siguen pendientes de autorización.
