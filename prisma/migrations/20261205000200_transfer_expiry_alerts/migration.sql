-- Fase 5: vencimientos de transferencias con avisos internos + alerta previa de revisión.
-- Mismas garantías que antes (SKIP LOCKED, idempotente, auditado). La reserva vencida libera el
-- horario en la misma sentencia (la disponibilidad ya trata un PENDING vencido como libre).

CREATE OR REPLACE FUNCTION app_expire_pending_bookings(p_batch integer, p_tenant uuid DEFAULT NULL)
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
    RETURNING b.id, b.tenant_id, b.court_id, b.starts_at, b.expires_at, b.customer_email,
              b.payment_status, b.player_user_id, b.code, b.customer_name
  ), aud AS (
    INSERT INTO audit_logs (tenant_id, actor_type, action, entity_type, entity_id, metadata)
    SELECT upd.tenant_id, 'SYSTEM', 'booking.status.expired', 'booking', upd.id::text,
           jsonb_build_object('reason', CASE upd.payment_status
                                          WHEN 'AWAITING_TRANSFER' THEN 'transfer_not_reported'
                                          WHEN 'TRANSFER_REPORTED' THEN 'transfer_not_reviewed'
                                          ELSE 'pending_timeout' END,
                              'expiresAt', upd.expires_at, 'courtId', upd.court_id, 'startsAt', upd.starts_at)
      FROM upd
    RETURNING 1
  ), notif AS (
    INSERT INTO notifications (tenant_id, kind, recipient, dedupe_key, booking_id)
    SELECT upd.tenant_id, 'booking_expired', upd.customer_email, 'booking:' || upd.id || ':expired', upd.id
      FROM upd WHERE upd.customer_email IS NOT NULL
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING 1
  ), inbox_tenant AS (
    -- Si el jugador había informado la transferencia y venció sin revisión, el complejo debe
    -- revisarla igual: puede haber dinero recibido de un turno ya liberado.
    INSERT INTO inbox_notifications (tenant_id, kind, title, body, link, booking_id)
    SELECT upd.tenant_id, 'transfer_review_expired',
           'Venció sin revisar · ' || upd.code,
           left(upd.customer_name || ' había informado una transferencia y el plazo de revisión terminó. El turno se liberó: revisá tu cuenta y, si llegó el dinero, registrá una incidencia.', 500),
           '/transferencias?estado=todas', upd.id
      FROM upd WHERE upd.payment_status = 'TRANSFER_REPORTED'
    RETURNING 1
  ), inbox_player AS (
    INSERT INTO inbox_notifications (user_id, kind, title, body, link, booking_id)
    SELECT upd.player_user_id, 'booking_expired', 'Reserva vencida · ' || upd.code,
           CASE upd.payment_status
             WHEN 'AWAITING_TRANSFER' THEN 'No se informó la transferencia a tiempo y el turno se liberó. Si ya transferiste, comunicate con el complejo.'
             WHEN 'TRANSFER_REPORTED' THEN 'El complejo no llegó a verificar tu transferencia a tiempo y el turno se liberó. Comunicate con el complejo: la devolución, si corresponde, la gestiona el complejo.'
             ELSE 'La solicitud no se aprobó a tiempo y el turno se liberó.' END,
           '/mis-turnos', upd.id
      FROM upd WHERE upd.player_user_id IS NOT NULL
    RETURNING 1
  )
  SELECT upd.id, upd.tenant_id FROM upd;
END $$;

REVOKE EXECUTE ON FUNCTION app_expire_pending_bookings(integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_expire_pending_bookings(integer, uuid) TO app_runtime;

-- Aviso al complejo ANTES de que venza el plazo de revisión (una sola vez por reserva).
CREATE OR REPLACE FUNCTION app_transfer_review_alerts(p_lead_minutes integer)
  RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  IF p_lead_minutes IS NULL OR p_lead_minutes < 5 OR p_lead_minutes > 240 THEN
    RAISE EXCEPTION 'anticipación fuera de rango (5..240)';
  END IF;
  WITH due AS (
    SELECT b.id FROM bookings b
     WHERE b.status = 'PENDING' AND b.payment_status = 'TRANSFER_REPORTED' AND b.review_alerted_at IS NULL
       AND b.expires_at > now() AND b.expires_at <= now() + make_interval(mins => p_lead_minutes)
     LIMIT 500
     FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE bookings b SET review_alerted_at = now() FROM due WHERE b.id = due.id
    RETURNING b.id, b.tenant_id, b.code, b.customer_name, b.expires_at
  ), ins AS (
    INSERT INTO inbox_notifications (tenant_id, kind, title, body, link, booking_id)
    SELECT upd.tenant_id, 'transfer_review_due', 'Revisá la transferencia · ' || upd.code,
           left('El plazo para verificar la transferencia de ' || upd.customer_name || ' vence pronto. Si no la confirmás, el turno se libera.', 500),
           '/transferencias', upd.id
      FROM upd
    RETURNING 1
  )
  SELECT count(*) INTO n FROM ins;
  RETURN n;
END $$;

REVOKE EXECUTE ON FUNCTION app_transfer_review_alerts(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_transfer_review_alerts(integer) TO app_runtime;
