# Fase 1 — Pendientes y riesgos

## Funcionalidades pendientes (fases siguientes)

- Panel: calendario semanal, alta/edición de canchas, horarios y precios desde la UI (hoy se cargan por seed/SQL),
  reprogramación desde la UI (el motor ya la soporta y está probada), ficha de clientes, personalización del complejo
  (logo con validación de URL/subida).
- Superadmin: gestión de planes y registro de suscripciones desde la UI (el modelo existe), detalle de auditoría.
- Vencimiento automático de reservas PENDING (`expires_at` + job) para que no retengan turnos indefinidamente.
- Consulta/cancelación de la reserva por el cliente con su código (+ verificación por email).
- Notificaciones (email/WhatsApp), recuperación de contraseña, 2FA para dueños y superadmin.
- Mercado Pago (OAuth por complejo, señas, webhooks idempotentes, conciliación) — solo diseño, ver ARQUITECTURA.md.
- Job de limpieza de `rate_limits` y sesiones vencidas.
- CI (GitHub Actions con servicio PostgreSQL) corriendo `npm run check`.

## Riesgos residuales y controles pendientes

| Riesgo | Estado / mitigación |
|---|---|
| **Rate limiting sin IP real.** Sin `AUTH_CLIENT_IP_HEADER`/`TRUST_PROXY_HOPS`, todos los clientes comparten un contador: no se puede evadir, pero un atacante puede bloquear el login de todos (se observó en las pruebas: el cupo de 5 intentos/15 min se agotó). | **Obligatorio configurar el proxy en producción.** |
| Spam de solicitudes PENDING que ocupan turnos. | Rate limit por IP y por IP+complejo. Falta vencimiento de PENDING y CAPTCHA/verificación. |
| RLS depende de variables que fija la app (`app.platform_admin`). Protege contra olvidos de filtro, no contra SQL arbitrario con el rol de la app. | Sin SQL dinámico con datos del usuario; futuro: rol de BD separado para plataforma. |
| Tablas de autenticación (`users`, `sessions`, `accounts`) sin RLS. | Acceso solo vía Better Auth y la DAL. |
| CSP con `'unsafe-inline'` en scripts (requisito de hidratación de Next sin nonce). | Pendiente CSP con nonce. React escapa todo el contenido; no hay `dangerouslySetInnerHTML`. |
| Bloqueo por cuenta (10 intentos/15 min) permite bloquear a propósito la cuenta de otro. | Aceptable en Fase 1; evaluar CAPTCHA progresivo. |
| Sin 2FA ni recuperación de contraseña. | Pendiente. |
| Backups, monitoreo, alertas y retención de auditoría no definidos. | Pendiente de infraestructura. |
| Datos personales de clientes (nombre, teléfono, email) sin política de retención/borrado. | Pendiente (Ley 25.326). |
| Precio en `Int` centavos (máx. ~21 M por reserva). | Suficiente hoy; migrar a `BigInt` si hiciera falta. |

No se afirma que el sistema sea invulnerable: se recomienda una revisión de seguridad externa antes de producción.

## Problemas encontrados durante la fase

- Next.js 16 crea proyectos con `cacheComponents` activado → desactivado a propósito (ver ARQUITECTURA.md).
- Prisma interpreta la columna generada `period` como default → se declaró `dbgenerated(...)`; `db:drift` queda en cero.
- Con RLS, los usuarios no podían listar sus complejos → migración `tenant_member_visibility`.
- El servicio de plataforma devolvía `ZodError` crudo (terminaría en 500) → `parseOrThrow` (400 con campos).
- Better Auth confía por defecto en `X-Forwarded-For` (falsificable sin proxy) → se configura explícitamente.
- Prisma bloquea `migrate reset` cuando lo ejecuta un agente de IA → el setup E2E usa `migrate deploy` + vaciado de
  una base `*_e2e` dedicada.
- Prueba de mutación: al quitar la restricción EXCLUDE, 7 pruebas fallan y quedan solapamientos reales en la base,
  lo que confirma que la base es la última barrera y que las pruebas lo detectan.
