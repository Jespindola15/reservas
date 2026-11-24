-- Fase 5: aviso interno al JUGADOR dueño de una reserva, desde el contexto del complejo.
-- La política RLS de inbox_notifications no deja que un complejo escriba filas de jugadores;
-- esta función lo permite SOLO para el jugador vinculado a una reserva de ESE complejo.
CREATE FUNCTION app_inbox_notify_booking_player(p_booking uuid, p_kind text, p_title text, p_body text, p_link text)
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO inbox_notifications (user_id, kind, title, body, link, booking_id)
  SELECT b.player_user_id, left(p_kind, 60), left(p_title, 140), left(p_body, 500), p_link, b.id
    FROM bookings b
   WHERE b.id = p_booking
     AND b.player_user_id IS NOT NULL
     AND (b.tenant_id = app_current_tenant_id() OR app_is_platform_admin())
$$;
REVOKE EXECUTE ON FUNCTION app_inbox_notify_booking_player(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_inbox_notify_booking_player(uuid, text, text, text, text) TO app_runtime;

-- "Mis turnos" necesita el estado financiero, el importe a transferir y el vencimiento del bloqueo.
DROP FUNCTION IF EXISTS app_player_bookings(integer);
CREATE FUNCTION app_player_bookings(p_limit integer)
  RETURNS TABLE (
    id uuid, tenant_id uuid, code text, status text, starts_at timestamptz, ends_at timestamptz, duration_minutes integer,
    price_amount integer, currency text, tenant_slug text, tenant_name text, tenant_address text, tenant_timezone text,
    cancellation_minutes integer, court_name text, sport text, review_rating smallint,
    payment_status text, amount_due integer, expires_at timestamptz, transfer_reported_at timestamptz
  )
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT b.id, b.tenant_id, b.code, b.status::text, b.starts_at, b.ends_at, b.duration_minutes, b.price_amount, b.currency::text,
         t.slug, t.name, t.address, t.timezone, t.public_cancellation_minutes, c.name, c.sport::text,
         (SELECT v.rating FROM reviews v WHERE v.tenant_id = b.tenant_id AND v.booking_id = b.id),
         b.payment_status, b.amount_due, b.expires_at, b.transfer_reported_at
    FROM bookings b
    JOIN tenants t ON t.id = b.tenant_id
    JOIN courts c ON c.tenant_id = b.tenant_id AND c.id = b.court_id
   WHERE app_player_id() IS NOT NULL AND b.player_user_id = app_player_id()
   ORDER BY b.starts_at DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
$$;
REVOKE EXECUTE ON FUNCTION app_player_bookings(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_player_bookings(integer) TO app_runtime;
