# TURNUP — Pendientes y riesgos (actualizado en Fase 3)

## Resuelto en Fase 2 (antes pendiente)

- Vencimiento de reservas PENDING (job + guardia en la base).
- Gestión de canchas, horarios, feriados, tarifas e imágenes desde la UI.
- Calendario semanal, reprogramación desde la UI, ficha de clientes, personalización del complejo.
- Consulta/cancelación por el jugador (enlace privado con token HMAC).
- Unificación de la fuente de IP para rate limiting.

## Resuelto en Fase 3
Notificaciones por email (outbox), recuperación de contraseña, gestión de equipo, CSP de scripts con nonce,
PWA, tick único + limpieza + salud + alertas, scripts de backup/restauración, planes y límites, visor de
auditoría, CSV, vista mensual, reordenamiento, optimización de imágenes, abstracción S3/R2, avisos por cambios
de horario, CI. Detalle en `docs/FASE3.md`.

## Pendientes
- **Confirmar producción** (base, variables, migraciones aplicadas, función programada): ver `docs/INFRAESTRUCTURA.md` §1.
- Activar servicios externos con autorización: Resend (dominio verificado), monitor de `/api/health`,
  `ALERT_WEBHOOK_URL`, backups fuera del proveedor, R2 (opcional).
- 2FA (evaluado: plugin `twoFactor` de Better Auth), CAPTCHA progresivo, verificación del contacto del jugador.
- Pagos (Mercado Pago) y cobro de suscripciones — excluidos por pedido.
- Arrastrar y soltar en el calendario; recorte de imágenes; manifest por complejo; API versionada para app nativa.
- Política de retención de reservas/clientes/auditoría (decisión legal del dueño; hoy no se borran nunca).

## Riesgos residuales y controles pendientes

| Riesgo | Estado / mitigación |
|---|---|
| **IP de cliente sin proxy configurado**: el rate limiting de login y reservas usa un cupo global (no evadible, pero un abusador puede bloquear a todos). Se observó en pruebas. | **Obligatorio** `AUTH_CLIENT_IP_HEADER` en producción. |
| Límite de login por cuenta (10/15 min) permite bloquear a propósito la cuenta de otro. | Aceptable; evaluar CAPTCHA progresivo. Se observó al repetir pruebas. |
| Spam de solicitudes PENDING que retienen turnos. | Mitigado: vencen solas (plazo configurable) + rate limit. Falta CAPTCHA/verificación de contacto. |
| Enlace privado del jugador: quien lo obtenga puede ver y cancelar esa reserva. | Token de 256 bits, `noindex`, sin terceros, `Referrer-Policy`; rotar `BETTER_AUTH_SECRET` invalida todos. Futuro: verificación por email/SMS. |
| `app_expire_pending_bookings` es ejecutable por el rol de la app para cualquier complejo. | Solo vence lo objetivamente vencido (lo mismo que haría el job). |
| RLS depende de variables que fija la app. Protege contra olvidos de filtro, no contra SQL arbitrario con el rol de la app. | Sin SQL dinámico con datos del usuario. Futuro: rol de BD separado para plataforma/jobs. |
| La función programada de Netlify es el único scheduler: si falla o falta `CRON_SECRET`, no vencen solicitudes ni salen emails (las reservas nuevas igual liberan turnos vencidos en el momento). | `/api/health` lo marca `degraded` a los 5 min; configurar un monitor externo. |
| **Advertencia de `pg`** "client.query() while executing": la origina el runtime de Prisma 7 al lanzar consultas solapadas en una transacción (traza verificada; el código propio ya es secuencial). | No actualizar a `pg@9` hasta que Prisma lo resuelva; seguir el changelog. |
| Imágenes en la base (bytea) aumentan su tamaño y backups. | Ahora se optimizan (WebP ≤ 1600 px). Abstracción S3/R2 lista; migración sin ejecutar. |
| CSP con `'unsafe-inline'` en **estilos** (scripts ya usan nonce). | Riesgo bajo (no permite ejecutar JS). |
| Emails: si `EMAIL_PROVIDER` no está configurado en producción, no sale ningún aviso (los jugadores dependen de su enlace). | Configurar Resend; `/api/health` avisa “Emails desactivados”. |
| Un email con enlace de reset/invitación puede reenviarse o quedar en una bandeja comprometida. | Un solo uso, 1 h (reset) / 7 días (invitación), revocables; la invitación exige ingresar con el email invitado. |
| Bloqueo dirigido: alguien puede agotar el límite de pedidos de reset (3/h) o de login (10/15 min) de una cuenta ajena. | Aceptado; el atacante no obtiene acceso. Evaluar CAPTCHA. |
| La función `app_expire_pending_bookings` y la cola corren con un contexto “sistema” que ve todos los complejos. | Solo desde el tick protegido; sin entradas del usuario. |
| Backups: no hay evidencia de backups en producción. | Activar los del proveedor + `scripts/ops/backup.sh` y probar restauración mensual. |
| Tablas de autenticación sin RLS. | Acceso solo vía Better Auth y la DAL. |
| Sin 2FA ni política de retención de datos personales (Ley 25.326). | 2FA evaluado; retención: decisión legal pendiente. |

No se afirma que el sistema sea invulnerable ni que esté listo para producción: se recomienda revisión de
seguridad externa y pruebas de carga antes de operar con clientes reales.

## Problemas encontrados en la Fase 2

- El SQL que generó Prisma para cambiar el enum de deportes fallaba con datos existentes → reescrito con mapeo.
- Agregar un valor de enum y usarlo en una función en la misma migración no es posible → migración separada.
- Mensajes de éxito que se perdían al refrescar la página (formulario re-montado) → redirección con aviso.
- Clave de idempotencia generada en `useState` causaba diferencias de hidratación → generada en el servidor.
- Búsqueda por teléfono con separadores no encontraba al cliente → comparación por dígitos en SQL.
- `\\D` dentro de un template de JS se convertía en `D` → escape corregido (lo detectó la prueba).

## Problemas encontrados en la Fase 3

- El trigger de permisos bloqueaba el seed (rol dueño) → nueva migración que lo limita al rol de la app.
- La prueba de imágenes usaba un PNG falso de 12 bytes que antes se aceptaba: con la decodificación real se
  rechaza (correcto) → la prueba ahora usa una imagen real y verifica WebP, tamaño y EXIF eliminado.
- Los errores de jobs podían guardar/loguear una URL de base con contraseña → redacción central en logs y `job_runs`.
- El service worker recargaba la página al instalarse por primera vez y borraba formularios a medio llenar
  (lo detectó la suite E2E) → solo recarga cuando la persona elige “Actualizar”.
- En serverless el temporizador interno se habría iniciado en cada instancia → se desactiva solo en Netlify/Lambda.
