-- =============================================================================
-- Fase 2 · Bloque C (2/2): vencimiento de reservas PENDING + notas internas.
-- =============================================================================

ALTER TABLE "bookings"
  ADD COLUMN "expires_at" TIMESTAMPTZ(3),
  ADD COLUMN "expired_at" TIMESTAMPTZ(3),
  ADD COLUMN "internal_notes" TEXT;

CREATE INDEX "bookings_status_expires_at_idx" ON "bookings"("status", "expires_at");

-- PENDING existentes (de antes de esta fase) reciben un vencimiento explícito.
UPDATE "bookings" SET "expires_at" = "created_at" + interval '30 minutes'
WHERE "status" = 'PENDING' AND "expires_at" IS NULL;

-- Regla explícita: toda PENDING tiene vencimiento. CONFIRMED y demás no vencen solas.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_pending_has_expiry" CHECK ("status" <> 'PENDING' OR "expires_at" IS NOT NULL),
  ADD CONSTRAINT "bookings_internal_notes_length" CHECK ("internal_notes" IS NULL OR char_length("internal_notes") <= 2000);

-- -----------------------------------------------------------------------------
-- Guardia en la BASE: aunque el job no haya corrido todavía, una PENDING vencida
-- NO puede pasar a CONFIRMED (ni a ningún estado "jugado"). Y los estados
-- finales (CANCELLED, REJECTED, EXPIRED) no pueden reabrirse.
-- -----------------------------------------------------------------------------
CREATE FUNCTION app_guard_booking_status() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status IN ('CANCELLED', 'REJECTED', 'EXPIRED') THEN
      RAISE EXCEPTION 'booking_final_state';
    END IF;
    IF OLD.status = 'PENDING' AND NEW.status IN ('CONFIRMED', 'COMPLETED', 'NO_SHOW')
       AND OLD.expires_at IS NOT NULL AND OLD.expires_at <= now() THEN
      RAISE EXCEPTION 'booking_expired';
    END IF;
  END IF;
  -- Reprogramar una PENDING vencida tampoco está permitido.
  IF OLD.status = 'PENDING' AND NEW.status = 'PENDING'
     AND (NEW.starts_at <> OLD.starts_at OR NEW.court_id <> OLD.court_id)
     AND OLD.expires_at IS NOT NULL AND OLD.expires_at <= now() THEN
    RAISE EXCEPTION 'booking_expired';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "bookings_guard_status"
  BEFORE UPDATE ON "bookings"
  FOR EACH ROW EXECUTE FUNCTION app_guard_booking_status();

-- -----------------------------------------------------------------------------
-- Job de vencimiento. Seguro ante ejecuciones simultáneas:
--  - FOR UPDATE SKIP LOCKED: dos ejecuciones nunca toman la misma fila;
--  - el UPDATE vuelve a exigir status = 'PENDING' (idempotente);
--  - el trigger de ocupación libera el turno en la misma transacción;
--  - deja un registro de auditoría por reserva vencida (actor SYSTEM).
-- SECURITY DEFINER porque recorre todos los complejos; solo vence lo que
-- objetivamente ya venció. p_tenant permite acotarlo a un complejo.
-- -----------------------------------------------------------------------------
CREATE FUNCTION app_expire_pending_bookings(p_batch integer, p_tenant uuid DEFAULT NULL)
  RETURNS TABLE (booking_id uuid, tenant_id uuid)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_batch IS NULL OR p_batch < 1 OR p_batch > 1000 THEN
    RAISE EXCEPTION 'batch fuera de rango (1..1000)';
  END IF;
  RETURN QUERY
  WITH due AS (
    SELECT b.id FROM bookings b
    WHERE b.status = 'PENDING'
      AND b.expires_at <= now()
      AND (p_tenant IS NULL OR b.tenant_id = p_tenant)
    ORDER BY b.expires_at
    LIMIT p_batch
    FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE bookings b
       SET status = 'EXPIRED', expired_at = now(), version = b.version + 1, updated_at = now()
      FROM due
     WHERE b.id = due.id AND b.status = 'PENDING'
    RETURNING b.id, b.tenant_id, b.court_id, b.starts_at, b.expires_at
  ), aud AS (
    INSERT INTO audit_logs (tenant_id, actor_type, action, entity_type, entity_id, metadata)
    SELECT upd.tenant_id, 'SYSTEM', 'booking.status.expired', 'booking', upd.id::text,
           jsonb_build_object('reason', 'pending_timeout', 'expiresAt', upd.expires_at,
                              'courtId', upd.court_id, 'startsAt', upd.starts_at)
      FROM upd
    RETURNING 1
  )
  SELECT upd.id, upd.tenant_id FROM upd;
END $$;

REVOKE EXECUTE ON FUNCTION app_expire_pending_bookings(integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_expire_pending_bookings(integer, uuid) TO app_runtime;
