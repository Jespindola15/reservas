# Mercado Pago para TURNUP — informe técnico y comercial (sin implementar)

> Estado: **diseño**. TURNUP no realiza cobros reales. Este informe define cómo integrar Mercado Pago (MP)
> en Argentina antes de escribir código. Tarifas y condiciones de MP cambian: verificarlas en
> mercadopago.com.ar (Comisiones y cargos) antes de lanzar.

## 1. Qué necesitamos resolver

| Necesidad | Solución de MP recomendada |
|---|---|
| Cada complejo cobra señas/reservas **en su propia cuenta** | **Marketplace (Split de pagos 1:1)**: el complejo vincula su cuenta a TURNUP por **OAuth**; TURNUP crea el cobro con el `access_token` del complejo. El dinero se acredita al complejo. |
| TURNUP cobra (opcional) una comisión por reserva | `marketplace_fee` (Checkout Pro) o `application_fee` (Checkout API) en cada cobro. MP descuenta primero su comisión y luego la del marketplace. |
| TURNUP cobra **sus propias suscripciones** mensuales | **Suscripciones** (`/preapproval`) con la cuenta de MP **de TURNUP**, separada de la de los complejos. MP genera las cuotas y reintenta pagos rechazados. |
| Confirmar pagos de forma confiable | **Webhooks** (tópicos `payment`, `subscription_preapproval`, `subscription_authorized_payment`, reclamos y contracargos) con **validación de firma** (`x-signature`, HMAC) + consulta del pago a la API. |

## 2. Flujo propuesto — señas de reservas (dinero del complejo)

1. **Vincular cuenta**: en Panel → Pagos, el dueño toca "Vincular Mercado Pago" → OAuth de MP → TURNUP guarda
   `access_token` / `refresh_token` **cifrados** (por complejo, con RLS) y el `user_id` del vendedor.
   Desvincular = revocar y borrar tokens. Webhook de vinculación/desvinculación para detectar revocaciones.
2. **Reserva con seña**: al confirmar, el servidor calcula la seña (regla del complejo, nunca el navegador) y
   crea una **preferencia de Checkout Pro** con el token del complejo, `external_reference = booking_id`,
   `notification_url` propia, vencimiento corto (`expiration_date_to` = vencimiento de la reserva pendiente) y
   `marketplace_fee` (0 si TURNUP no cobra comisión por reserva).
3. La reserva queda **PENDIENTE de pago** (bloquea el horario con la misma restricción antisolapamiento) hasta que
   el webhook confirme `approved`. Si el pago no llega antes del vencimiento → la reserva vence y el turno se libera
   (mecanismo que ya existe para solicitudes pendientes).
4. **Webhook** → validar firma → `GET /v1/payments/{id}` con el token del complejo → registrar
   `booking_payments` (kind `DEPOSIT`, method `MERCADOPAGO`, `external_id` único: idempotente) → confirmar.
5. **Estados**: `approved` (confirma), `pending`/`in_process` (espera; la reserva sigue pendiente hasta vencer),
   `rejected` (se informa y se puede reintentar), `refunded`/`charged_back` (se registra `REFUND` y se avisa al
   complejo), `cancelled`/`expired` (libera).
6. **Devoluciones**: desde el panel ("Devolver seña") vía API de reembolsos con el token del complejo; queda
   registrada y auditada. La política de cancelación del complejo define si corresponde.
7. **Conciliación**: tarea diaria que compara pagos `approved` de las últimas 48 h (búsqueda por
   `external_reference`) contra `booking_payments` y alerta diferencias. Reportes de MP para el complejo.

## 3. Flujo propuesto — suscripciones de TURNUP (dinero de TURNUP)

- Cuenta de MP **de TURNUP** (separada). Por plan, un `preapproval_plan` o suscripción sin plan con monto mensual.
- El dueño se suscribe desde el panel → checkout de MP → webhook `subscription_preapproval` = `authorized`.
- Cada cuota: `subscription_authorized_payment` → se registra en `subscription_payments`
  (`external_provider = mercadopago`, `external_id` único — la tabla ya está preparada) y se extiende el vencimiento.
- Rechazos: MP reintenta; TURNUP muestra "pago pendiente" y aplica la gracia (PAST_DUE) antes de suspender.
- Cancelación por el dueño: `PUT /preapproval/{id}` status `cancelled` desde el panel (baja simple).

## 4. Seguridad

- Tokens OAuth cifrados en reposo (mismo esquema que los enlaces sellados), nunca enviados al navegador.
- Montos siempre calculados en el servidor; `external_reference` firmado/validado.
- Webhooks: firma obligatoria, respuesta 200 rápida, procesamiento idempotente en la cola existente.
- Ninguna tarjeta pasa por TURNUP (Checkout Pro = página de MP). Sin "pagos simulados" en producción.

## 5. Costos (referencias públicas, a confirmar)

- Checkout Pro / Link de pago: la comisión depende del plazo de acreditación elegido por el vendedor; fuentes
  públicas de 2026 informan ~6,29 % + IVA al instante y ~1,49 % + IVA a 35 días (con escalones intermedios).
- Dinero en cuenta por QR: ~0,8 % + IVA.
- La comisión de MP se descuenta de lo que recibe el vendedor (el complejo); la de TURNUP (si existe) sale del saldo.
- MP actúa como agente de percepción/retención impositiva en Argentina.
- Integración: sin costo de alta. Costo de TURNUP = desarrollo + mantenimiento (no hay servicios pagos nuevos).

## 6. Requisitos y limitaciones

- TURNUP necesita una **aplicación** en "Tus integraciones" de MP (cuenta de TURNUP verificada) con OAuth
  habilitado y URL de retorno; credenciales de prueba y de producción separadas.
- Cada complejo necesita su **cuenta de MP** (idealmente cuenta de negocio) para vincular.
- Split 1:1: un cobro = un vendedor (no se reparte entre varios complejos en un mismo pago).
- Disponibilidad del dinero según el plazo que configure el complejo en su cuenta.
- Contracargos: el riesgo es del vendedor (complejo); TURNUP registra y avisa.
- Facturación: cada complejo factura sus reservas; TURNUP factura sus suscripciones (definir con contador).

## 7. Plan de implementación (cuando se autorice)

1. Cuenta y aplicación de MP de TURNUP (prueba) — **acción del dueño**.
2. Tabla `payment_accounts` (por complejo, tokens cifrados, RLS) + pantalla Panel → Pagos (OAuth).
3. Implementación de `PaymentsProvider` (`src/modules/payments/provider.ts`) para Checkout Pro + webhook firmado.
4. Reservas con seña online (opt-in por complejo) + vencimiento automático + devoluciones.
5. Suscripciones de TURNUP con `/preapproval` + conciliación diaria.
6. Pruebas con credenciales y usuarios de prueba de MP; luego producción con un complejo piloto.
