/**
 * Arquitectura de pagos online (PREPARADA, NO IMPLEMENTADA).
 *
 * Hoy TURNUP no cobra: la seña y el saldo se abonan al complejo y el personal los registra a
 * mano (booking_payments). Este contrato define cómo se integrará Mercado Pago más adelante
 * sin tocar el flujo de reserva:
 *
 *  1. Al confirmar una reserva con seña, el servidor crea una "preferencia" con
 *     `createCheckout` (monto calculado en el SERVIDOR, nunca enviado por el navegador),
 *     con external_reference = id de la reserva e idempotencia por reserva.
 *  2. El jugador paga en el checkout del proveedor (TURNUP nunca ve ni guarda datos de tarjeta).
 *  3. El proveedor notifica por webhook; `verifyWebhook` valida la firma y se consulta el pago
 *     a la API del proveedor (no se confía en el cuerpo del webhook).
 *  4. Se registra un booking_payment (kind DEPOSIT, method MERCADOPAGO) con external_id único,
 *     de forma idempotente. Nunca se marca un pago como exitoso sin esa confirmación.
 *
 * Mientras no exista una implementación, `paymentsProvider()` devuelve null y la UI muestra
 * "se abona en el complejo". No hay simulación de pagos exitosos.
 */
export type CheckoutRequest = {
  tenantId: string;
  bookingId: string;
  amountCents: number;
  currency: string;
  description: string;
  payerEmail: string | null;
  successUrl: string;
  failureUrl: string;
};

export type CheckoutSession = { provider: "mercadopago"; checkoutUrl: string; externalReference: string };

export type VerifiedPayment = {
  provider: "mercadopago";
  externalId: string;
  bookingId: string;
  amountCents: number;
  status: "approved" | "pending" | "rejected" | "refunded";
};

export interface PaymentsProvider {
  createCheckout(req: CheckoutRequest): Promise<CheckoutSession>;
  verifyWebhook(req: Request): Promise<VerifiedPayment | null>;
}

/** Sin proveedor configurado (estado actual): no hay cobros online. */
export function paymentsProvider(): PaymentsProvider | null {
  return null;
}
