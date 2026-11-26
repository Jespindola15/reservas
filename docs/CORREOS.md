# Correos transaccionales (Brevo)

TURNUP envía emails con la API transaccional de **Brevo**, solo desde el servidor. Resend queda
como proveedor alternativo (`EMAIL_PROVIDER=resend`) con el mismo código: cambiar de proveedor es
cambiar una variable.

## Cómo funciona

1. **Cola persistente (outbox).** Cada evento (reserva, pago, registro…) guarda un aviso en la
   tabla `notifications` **dentro de la misma transacción** que el evento. Una clave de
   deduplicación única impide que el mismo evento genere dos emails.
2. **Envío.**
   - En el momento: al terminar la respuesta de la acción, vía `after()`.
   - Si no salió en el momento, en la tarea programada (cada 30 minutos).
   - Varias ejecuciones simultáneas nunca toman el mismo aviso (`FOR UPDATE SKIP LOCKED`).
3. **Contenido armado al enviar.** El email se arma con los datos actuales:
   - si la reserva cambió (cancelada, reprogramada, ya empezó), el aviso viejo se descarta;
   - los enlaces privados se calculan en ese momento;
   - los enlaces secretos (contraseña, verificación, invitación) viajan cifrados y se borran después del envío.
4. **Idempotencia en Brevo.** Cada envío lleva la cabecera `idempotencyKey` con el id del aviso
   (UUID, 30 min). Si un envío se reintenta después de una caída, Brevo descarta el duplicado.
5. **Errores.**
   - **Temporales** (red, 429, 5xx): se reintentan a los 1, 5, 15, 60 y 240 minutos.
   - **Permanentes** (dirección inválida): quedan como fallidos, sin reintentar.
   - **Problemas de la cuenta de Brevo** (clave, créditos, remitente): se corta el lote sin gastar
     intentos, se reintenta en 15 minutos y se avisa al superadmin.
6. **Aceptado ≠ entregado.**
   - `SENT` significa que Brevo **aceptó** el email; se guardan el proveedor y el `messageId`.
   - La entrega real (entregado, rebote, bloqueado, spam) llega por el webhook y se guarda en `delivery_status`.
7. **Nunca bloquea la operación.** Las reservas y los pagos funcionan aunque Brevo esté caído o
   mal configurado: los emails quedan en cola. Un `EMAIL_PROVIDER` inválido no impide arrancar el sitio.

## Cupo diario (plan gratuito: 300 emails por día)

- **Dónde se cuenta:** en PostgreSQL, con una sola sentencia atómica (tabla `rate_limits`, una
  fila por día UTC). No depende de la memoria de Netlify.
- **Hasta dónde puede llegar cada prioridad** (con `EMAIL_DAILY_LIMIT=300`):

| Prioridad | Tipos | Puede usar hasta |
|---|---|---|
| 1 | Recuperar contraseña, verificar email, alertas al superadmin | 300 |
| 2 | Confirmación, cancelación, rechazo, cambio, vencimiento | 291 |
| 3 | Transferencias y pagos (instrucciones, informada, aprobada, rechazada, por vencer) | 276 |
| 4 | Avisos al complejo, invitaciones, suscripción, resumen diario | 249 |
| 5 | Recordatorios 24 h y 2 h, bienvenidas | 219 |

- **Sin cupo:**
  - Los recordatorios se descartan: al día siguiente ya no sirven.
  - El resto se aplaza a las 00:05 UTC del día siguiente.
- **Alertas al superadmin:** al llegar al 80 % y al 95 % del cupo (una vez por día).
- **Límite del método:** Brevo no documenta a qué hora exacta reinicia el cupo diario. Por eso lo
  no crítico deja margen.

## Variables de entorno (Netlify → Site configuration → Environment variables)

| Variable | Valor | Secreta |
|---|---|---|
| `EMAIL_PROVIDER` | `brevo` | No |
| `BREVO_API_KEY` | Clave de la API de Brevo (empieza con `xkeysib-`) | **Sí** |
| `EMAIL_FROM` | Remitente verificado en Brevo (p. ej. `turnup.avisos@gmail.com`) | No |
| `EMAIL_FROM_NAME` | `TURNUP` | No |
| `EMAIL_DAILY_LIMIT` | `300` (opcional; es el valor por defecto) | No |
| `BREVO_WEBHOOK_SECRET` | Opcional: 32+ caracteres al azar (`openssl rand -hex 24`) | **Sí** |
| `EMAIL_TEST_RECIPIENTS` | Opcional: direcciones extra para el correo de prueba | No |

## Webhook de entrega (opcional, recomendado)

1. En Netlify, cargá `BREVO_WEBHOOK_SECRET` (secreta) y desplegá.
2. En Brevo, andá a **Transactional → Settings → Webhooks → Add a new webhook**.
3. Configuralo así:
   - URL: `https://turn-up-sn.netlify.app/api/webhooks/brevo`.
   - Autenticación: **Bearer token** con el mismo secreto. Si solo ofrece usuario y contraseña,
     cualquier usuario y el secreto como contraseña.
   - Eventos: *Delivered, Soft bounce, Hard bounce, Blocked, Invalid email, Spam, Deferred, Error*.
     Los de apertura y clic son opcionales.
4. En `/admin/correos`, la columna Estado muestra "Entregado", "Rebotó", etc.

## Panel del superadmin (`/admin/correos`)

- **Resumen:** cupo usado hoy, aceptados hoy (y entregados o con problemas si hay webhook), en
  cola, esperando cupo y fallidos de los últimos 7 días.
- **Tabla de emails:**
  - Columnas: fecha, tipo, prioridad, destinatario (parcialmente oculto), complejo, estado,
    estado de entrega, intentos y motivo.
  - Filtros: estado, tipo, complejo y email.
- **Reintento manual** de fallidos o descartados:
  - Al enviarse se revalida que todavía corresponda.
  - No se permite para emails con enlace secreto, porque el enlace ya se borró.
- **Correo de prueba:** a tu email o a `EMAIL_TEST_RECIPIENTS`. Máximo 5 por hora y queda en la auditoría.

## Remitente de Gmail (sin dominio propio): limitaciones reales

Según la documentación de Brevo:

- **El remitente se reemplaza.** Las direcciones de correos gratuitos (gmail.com, yahoo.com,
  outlook.com) no se pueden autenticar con DKIM ni DMARC. Brevo **reemplaza el remitente** por una
  dirección propia (por ejemplo `…@…t-sender-sib.com` en transaccionales). TURNUP pone como
  "Responder a" el email de contacto del complejo, así las respuestas llegan a quien corresponde.
- **Más spam.** Gmail, Yahoo y Microsoft filtran más los envíos desde direcciones gratuitas: parte
  de los emails puede ir a Spam o Promociones.
- **Para una entrega confiable** hace falta un dominio propio autenticado en Brevo (DKIM y DMARC).
  Con dominio: autenticarlo en Brevo → cambiar `EMAIL_FROM` → listo, sin cambios de código.

**No se puede afirmar que los emails lleguen hasta hacer una prueba real.** Después de desplegar,
usá **Enviar correo de prueba** y revisá:

- en qué carpeta llegó;
- qué remitente muestra;
- el log de Brevo (**Transactional → Logs**).

## Correos por destinatario

- **Jugador:**
  - bienvenida;
  - verificación de email;
  - recuperación de contraseña;
  - solicitud recibida;
  - instrucciones para transferir;
  - transferencia informada;
  - pago aprobado (reemplaza a "confirmada" cuando hubo transferencia);
  - pago rechazado;
  - reserva confirmada, modificada, cancelada o rechazada;
  - vencimiento;
  - recordatorios 24 h y 2 h (solo confirmadas, una vez por horario, nunca pasados).
- **Complejo** (cada aviso se puede apagar en *Ajustes → Avisos por email*, con dirección de
  destino propia):
  - nueva reserva o solicitud;
  - transferencia para verificar;
  - transferencia por vencer;
  - cancelación de un jugador;
  - incidencia de pago;
  - aviso de suscripción;
  - resumen diario.
  - La bienvenida y las invitaciones al equipo siempre se envían.
- **Superadmin:**
  - nuevo complejo (a los demás superadmins);
  - cupo diario al 80 % y 95 %;
  - fallas de envío o cuenta del proveedor caída.

  No existe un flujo de "solicitud de activación" de complejos: los crea el superadmin.

## Verificación de email

- No es obligatoria para ingresar: las cuentas existentes siguen funcionando igual.
- El enlace lo firma Better Auth, vence en 24 h y sirve para esa cuenta.
- Se envía al registrarse. También se puede pedir de nuevo desde el perfil (máximo 3 por hora por cuenta).
