# TURNUP — Pendientes y riesgos (actualizado en Fase 2)

## Resuelto en Fase 2 (antes pendiente)

- Vencimiento de reservas PENDING (job + guardia en la base).
- Gestión de canchas, horarios, feriados, tarifas e imágenes desde la UI.
- Calendario semanal, reprogramación desde la UI, ficha de clientes, personalización del complejo.
- Consulta/cancelación por el jugador (enlace privado con token HMAC).
- Unificación de la fuente de IP para rate limiting.

## Pendientes (fuera del alcance de la Fase 2)

- Pagos (Mercado Pago), suscripciones automáticas — explícitamente excluidos.
- Notificaciones (email/WhatsApp): hoy el jugador debe guardar su enlace; si lo pierde, solo el complejo puede ayudarlo.
- Recuperación de contraseña, 2FA, gestión de equipo (alta de STAFF) por el propio dueño.
- Reordenar canchas e imágenes; recorte/compresión de imágenes; almacenamiento de objetos (S3/R2).
- Arrastrar y soltar en el calendario; vista mensual; exportaciones.
- Superadmin: planes y suscripciones desde la UI (modelo existente), visor de auditoría.
- Limpieza periódica de `rate_limits` y sesiones vencidas (función existe: `purgeExpiredRateLimits`).
- CI (GitHub Actions con servicio PostgreSQL) ejecutando `npm run check`.
- Avisar en la UI qué reservas existentes quedan fuera de un horario nuevo o de un feriado cargado después
  (hoy se conservan y se advierte con un texto).

## Riesgos residuales y controles pendientes

| Riesgo | Estado / mitigación |
|---|---|
| **IP de cliente sin proxy configurado**: el rate limiting de login y reservas usa un cupo global (no evadible, pero un abusador puede bloquear a todos). Se observó en pruebas. | **Obligatorio** `AUTH_CLIENT_IP_HEADER` en producción. |
| Límite de login por cuenta (10/15 min) permite bloquear a propósito la cuenta de otro. | Aceptable; evaluar CAPTCHA progresivo. Se observó al repetir pruebas. |
| Spam de solicitudes PENDING que retienen turnos. | Mitigado: vencen solas (plazo configurable) + rate limit. Falta CAPTCHA/verificación de contacto. |
| Enlace privado del jugador: quien lo obtenga puede ver y cancelar esa reserva. | Token de 256 bits, `noindex`, sin terceros, `Referrer-Policy`; rotar `BETTER_AUTH_SECRET` invalida todos. Futuro: verificación por email/SMS. |
| `app_expire_pending_bookings` es ejecutable por el rol de la app para cualquier complejo. | Solo vence lo objetivamente vencido (lo mismo que haría el job). |
| RLS depende de variables que fija la app. Protege contra olvidos de filtro, no contra SQL arbitrario con el rol de la app. | Sin SQL dinámico con datos del usuario. Futuro: rol de BD separado para plataforma/jobs. |
| Programador interno en el proceso de Next: si el servidor está caído no vence nada (al volver, procesa lo atrasado; además las reservas nuevas liberan en el momento). | Para alta disponibilidad, sumar cron externo (endpoint o CLI). |
| **Advertencia de `pg`** "client.query() while executing": la origina el runtime de Prisma 7 al lanzar consultas solapadas en una transacción (traza verificada; el código propio ya es secuencial). | No actualizar a `pg@9` hasta que Prisma lo resuelva; seguir el changelog. |
| Imágenes en la base (bytea) aumentan su tamaño y backups. | Límite 6 × 1,5 MB por cancha; migrar a almacenamiento de objetos. |
| CSP con `'unsafe-inline'` en scripts. | Pendiente CSP con nonce. |
| Tablas de autenticación sin RLS. | Acceso solo vía Better Auth y la DAL. |
| Sin 2FA, backups, monitoreo ni política de retención de datos personales (Ley 25.326). | Pendientes de infraestructura/legal. |

No se afirma que el sistema sea invulnerable ni que esté listo para producción: se recomienda revisión de
seguridad externa y pruebas de carga antes de operar con clientes reales.

## Problemas encontrados en la Fase 2

- El SQL que generó Prisma para cambiar el enum de deportes fallaba con datos existentes → reescrito con mapeo.
- Agregar un valor de enum y usarlo en una función en la misma migración no es posible → migración separada.
- Mensajes de éxito que se perdían al refrescar la página (formulario re-montado) → redirección con aviso.
- Clave de idempotencia generada en `useState` causaba diferencias de hidratación → generada en el servidor.
- Búsqueda por teléfono con separadores no encontraba al cliente → comparación por dígitos en SQL.
- `\\D` dentro de un template de JS se convertía en `D` → escape corregido (lo detectó la prueba).
