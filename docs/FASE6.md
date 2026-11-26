# Fase 6: correos transaccionales con Brevo

Rama: `fase6-correos-brevo` (sale de `main` 611b2fb).

Estado:
- Nada de esto está en producción.
- La migración solo se probó en una rama aislada de Neon.
- No se hizo ningún envío real por Brevo: la clave solo existe en Netlify.

Detalle operativo: `docs/CORREOS.md`.

## Auditoría previa

Ya existía una base sólida, que se reutilizó sin duplicar código:
- cola persistente con deduplicación (`notifications`);
- procesador con `SKIP LOCKED` y reintentos con espera creciente;
- plantillas con escape de HTML y versión de texto;
- enlaces secretos cifrados;
- proveedor Resend con idempotencia;
- envío inmediato con `after()` y tarea programada.

Faltaba lo siguiente:

| Faltante | Situación encontrada |
|---|---|
| Brevo | No había proveedor de Brevo. |
| Cupo diario | Sin control ni prioridades. |
| Verificación y bienvenida | No había verificación de email ni bienvenida al jugador. |
| Transferencias y pagos | Faltaban "transferencia informada" (al jugador) y "pago aprobado / rechazado": la confirmación tras transferir mandaba el email genérico. |
| Recordatorios | Uno solo, configurable en horas. Se pidieron dos: 24 h y 2 h. |
| Avisos al complejo | Faltaban transferencia por vencer (solo existía el aviso interno) y suscripción. No se podía elegir qué avisos recibir. |
| Superadministrador | Sin avisos ni panel de correos. |
| Entrega | No había registro de entrega: aceptado se confundía con entregado. |
| Configuración del correo | Un `EMAIL_PROVIDER` desconocido **impedía arrancar el sitio** (ver "Riesgo detectado"). |
| Estilo de los emails | Usaban azul marino, no la identidad negro, blanco y lima. |

## Implementado

- **Proveedor Brevo** (`providers.ts`):
  - API v3, solo servidor, cabecera `idempotencyKey`;
  - "Responder a" el email del complejo y etiqueta por tipo;
  - errores clasificados: temporal, permanente, cuenta caída o duplicado;
  - la clave nunca aparece en registros.
- **Cupo diario persistente y atómico** (`quota.ts`):
  - cinco prioridades con reserva para lo crítico;
  - sin cupo, se aplaza o se descarta según el tipo.
- **Procesador:**
  - orden por prioridad;
  - corte del lote cuando la cuenta del proveedor no puede enviar (sin gastar intentos);
  - alertas al superadmin sin ciclos (una por día, los avisos `admin_*` no generan alertas);
  - registro del proveedor que aceptó el email.
- **Eventos nuevos:**
  - bienvenida y verificación de email (Better Auth, enlace de 24 h, no obligatoria);
  - transferencia informada al jugador;
  - pago aprobado (reemplaza "confirmada" con la misma clave: nunca salen los dos);
  - pago rechazado y reserva rechazada (separada de la cancelación);
  - recordatorios de 24 h y 2 h;
  - transferencia por vencer al complejo;
  - suscripción por vencer o vencida;
  - nuevo complejo, cupo al 80 % y 95 %, y fallas de envío al superadmin.
- **Plantillas nuevas** (negro, blanco y verde lima):
  - logo PNG;
  - botón compatible con Outlook (VML);
  - diseño adaptable al celular;
  - insignia de estado;
  - datos completos de la reserva: complejo, cancha, deporte, fecha DD/MM/AAAA, horario 24 h,
    duración, código, precio, seña, saldo y estado;
  - contacto del complejo;
  - botón a Mis turnos o al enlace privado;
  - versión en texto plano.
- **Preferencias del complejo:** en *Ajustes → Avisos por email* se elige qué aviso recibir, a
  qué dirección, y se prenden o apagan los recordatorios.
- **Webhook de entrega** `POST /api/webhooks/brevo`:
  - autenticación Bearer o Basic con comparación en tiempo constante;
  - el estado solo avanza (un "demorado" tardío no pisa un "entregado").
- **Panel `/admin/correos`:**
  - cupo, aceptados, entregados, cola, fallidos y proveedor;
  - filtros y destinatario parcialmente oculto;
  - reintento manual seguro (auditado);
  - correo de prueba a direcciones autorizadas (máximo 5 por hora, auditado);
  - advertencia por remitente de Gmail.
- **Perfil del jugador:** aviso para confirmar el email y botón de reenvío (máximo 3 por hora).
- **Seguridad:**
  - límite de envíos en `/send-verification-email` (por IP y por cuenta);
  - la configuración de correo inválida ya no tira el sitio y se informa en `/admin/correos`,
    `/admin/sistema` y `/api/health`.

## Riesgo detectado en producción

La versión publicada valida `EMAIL_PROVIDER` contra una lista cerrada que no incluye `brevo`. Con
`EMAIL_PROVIDER=brevo` ya cargado en Netlify, cualquier nuevo despliegue de `main` haría fallar el
arranque de todo el sitio. Se avisó al usuario: poner `EMAIL_PROVIDER=disabled` hasta publicar esta fase.

## Migración `20261206000000_email_brevo`

Solo agrega columnas e índices. Es compatible con la versión anterior durante el intervalo entre
migrar y desplegar.

- `notifications`: `priority`, `provider`, `delivery_status`, `delivery_updated_at` e índices.
- `notifications_kind`: ahora acepta números (`booking_reminder_24h`).
- `tenants.owner_email_muted` (lista de tipos apagados, validada).

Probada en una rama aislada copia de producción:
- esquema igual al código;
- datos intactos: 5 complejos, 6 usuarios, 5 reservas;
- RLS activo;
- la rama se borró.

## Pruebas ejecutadas

- **TypeScript y ESLint:** sin errores.
- **Vitest:** 35 archivos y 272 pruebas, incluidas 17 nuevas de correos y la de renderizado de las 27 plantillas.
- **Playwright E2E:** 37 pruebas. Incluyen el panel de correos, el correo de prueba con el
  proveedor de registro, y el aviso y reenvío de verificación en el perfil.
- **Auditoría visual:** 6 anchos, con `/admin/correos`. Capturas de plantillas en `capturas/emails/`.
- **Compilación de producción:** con Next 16 y Node 22, la misma configuración que usa Netlify.

**No ejecutado:** envío real por Brevo y entregabilidad. Requiere desplegar, porque la clave está
solo en Netlify. Ver "Pasos para publicar".

## Limitaciones

- **Remitente de Gmail:** Brevo lo reemplaza por un remitente propio y parte de los emails puede ir
  a Spam. Hace falta un dominio propio autenticado.
- **Cupo diario:** el día del cupo se corta en UTC; Brevo no documenta la hora exacta de reinicio.
- **Webhook:** sin webhook configurado, el panel muestra "aceptado" pero no "entregado".
- **Rebotes:** no hay lista de supresión automática de direcciones que rebotan.
- **Recordatorio de 2 h:** con la tarea cada 30 minutos, sale entre 2 h y 1 h 30 min antes del turno.
- **Recordatorios:** el ajuste numérico anterior se reemplazó por un interruptor (24 h + 2 h).

## Pasos para publicar (con autorización)

1. En Netlify, revisar estas variables:
   - `EMAIL_PROVIDER=brevo`, `BREVO_API_KEY` (secreta), `EMAIL_FROM` (remitente verificado) y `EMAIL_FROM_NAME=TURNUP`;
   - opcional: `BREVO_WEBHOOK_SECRET`.
2. Correr un **Respaldo cifrado** en GitHub.
3. Aplicar la migración con `node scripts/ops/neon-safe-migrate.mjs`. Prueba en una rama aislada,
   crea la rama de respaldo y aplica.
4. Fusionar `fase6-correos-brevo` en `main` y hacer push (Netlify despliega).
5. En `/admin/correos`:
   - **Enviar correo de prueba** a tu email;
   - revisar la bandeja, la carpeta y el remitente que se muestra;
   - revisar el log de Brevo.
6. Opcional: configurar el webhook en Brevo (`docs/CORREOS.md`).
