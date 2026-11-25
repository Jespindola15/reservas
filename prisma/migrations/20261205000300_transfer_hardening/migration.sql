-- Fase 5.1: protecciones adicionales de las transferencias.
-- 1) Cada reserva guarda una COPIA de los datos de cobro mostrados al jugador (alias, CBU/CVU, titular,
--    banco, importe, moneda, política). Si el complejo cambia sus datos, las reservas existentes no cambian.
-- 2) La verificación registra el importe recibido y la referencia bancaria; una misma referencia no
--    puede confirmar dos reservas del mismo complejo (índice único parcial).
-- 3) Nuevos tipos de incidencia: pago menor o mayor al esperado y referencia repetida.
ALTER TABLE "bookings"
  ADD COLUMN "transfer_snapshot" JSONB,
  ADD COLUMN "payment_reference" TEXT,
  ADD COLUMN "payment_received_amount" INTEGER;
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_payment_reference_len" CHECK ("payment_reference" IS NULL OR char_length("payment_reference") BETWEEN 3 AND 60),
  ADD CONSTRAINT "bookings_payment_received_amount" CHECK ("payment_received_amount" IS NULL OR "payment_received_amount" BETWEEN 0 AND 100000000);
CREATE UNIQUE INDEX "bookings_payment_reference_uniq" ON "bookings" ("tenant_id", "payment_reference") WHERE "payment_reference" IS NOT NULL;

ALTER TABLE "payment_incidents" DROP CONSTRAINT "pi_kind";
ALTER TABLE "payment_incidents"
  ADD CONSTRAINT "pi_kind" CHECK ("kind" IN ('LATE_TRANSFER', 'PAID_BUT_EXPIRED', 'PAID_BUT_REJECTED', 'REFUND', 'UNDERPAID', 'OVERPAID', 'DUPLICATE_REFERENCE', 'OTHER'));

-- "Mis turnos" muestra los datos de cobro de SU reserva (la copia), no los actuales del complejo.
DROP FUNCTION IF EXISTS app_player_bookings(integer);
CREATE FUNCTION app_player_bookings(p_limit integer)
  RETURNS TABLE (
    id uuid, tenant_id uuid, code text, status text, starts_at timestamptz, ends_at timestamptz, duration_minutes integer,
    price_amount integer, currency text, tenant_slug text, tenant_name text, tenant_address text, tenant_timezone text,
    cancellation_minutes integer, court_name text, sport text, review_rating smallint,
    payment_status text, amount_due integer, expires_at timestamptz, transfer_reported_at timestamptz, transfer_snapshot jsonb
  )
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT b.id, b.tenant_id, b.code, b.status::text, b.starts_at, b.ends_at, b.duration_minutes, b.price_amount, b.currency::text,
         t.slug, t.name, t.address, t.timezone, t.public_cancellation_minutes, c.name, c.sport::text,
         (SELECT v.rating FROM reviews v WHERE v.tenant_id = b.tenant_id AND v.booking_id = b.id),
         b.payment_status, b.amount_due, b.expires_at, b.transfer_reported_at,
         -- Los datos bancarios solo mientras la reserva espera la transferencia o su revisión.
         CASE WHEN b.status = 'PENDING' AND b.payment_status IN ('AWAITING_TRANSFER', 'TRANSFER_REPORTED') THEN b.transfer_snapshot END
    FROM bookings b
    JOIN tenants t ON t.id = b.tenant_id
    JOIN courts c ON c.tenant_id = b.tenant_id AND c.id = b.court_id
   WHERE app_player_id() IS NOT NULL AND b.player_user_id = app_player_id()
   ORDER BY b.starts_at DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
$$;
REVOKE EXECUTE ON FUNCTION app_player_bookings(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_player_bookings(integer) TO app_runtime;
