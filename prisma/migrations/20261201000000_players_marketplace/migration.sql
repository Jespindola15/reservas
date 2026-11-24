-- Fase 4 · Plataforma de jugadores y marketplace. Aditiva: columnas con default o NULL, tablas y funciones nuevas.


ALTER TABLE "bookings" ADD COLUMN     "origin" TEXT,
ADD COLUMN     "player_user_id" UUID;

ALTER TABLE "courts" ADD COLUMN     "covered" BOOLEAN,
ADD COLUMN     "dimensions" TEXT,
ADD COLUMN     "lighting" BOOLEAN,
ADD COLUMN     "surface" TEXT;

ALTER TABLE "tenants" ADD COLUMN     "city" TEXT,
ADD COLUMN     "deposit_note" TEXT,
ADD COLUMN     "deposit_type" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "deposit_value" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "player_profiles" (
    "user_id" UUID NOT NULL,
    "phone" TEXT,
    "city" TEXT,
    "favorite_sports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "avatar" BYTEA,
    "avatar_updated_at" TIMESTAMPTZ(3),
    "notify_email" BOOLEAN NOT NULL DEFAULT true,
    "notify_reminders" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_profiles_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE "player_favorites" (
    "user_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_favorites_pkey" PRIMARY KEY ("user_id","tenant_id")
);

CREATE TABLE "reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "player_user_id" UUID,
    "rating" SMALLINT NOT NULL,
    "comment" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "reply" TEXT,
    "replied_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "review_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "reporter_user_id" UUID,
    "reporter_kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),
    "resolution" TEXT,

    CONSTRAINT "review_reports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant_daily_views" (
    "tenant_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tenant_daily_views_pkey" PRIMARY KEY ("tenant_id","day")
);

CREATE INDEX "player_favorites_tenant_id_idx" ON "player_favorites"("tenant_id");

CREATE UNIQUE INDEX "reviews_booking_id_key" ON "reviews"("booking_id");

CREATE INDEX "reviews_tenant_id_status_created_at_idx" ON "reviews"("tenant_id", "status", "created_at");

CREATE UNIQUE INDEX "reviews_tenant_id_id_key" ON "reviews"("tenant_id", "id");

CREATE UNIQUE INDEX "reviews_tenant_id_booking_id_key" ON "reviews"("tenant_id", "booking_id");

CREATE INDEX "review_reports_resolved_at_idx" ON "review_reports"("resolved_at");

CREATE UNIQUE INDEX "review_reports_review_id_reporter_user_id_key" ON "review_reports"("review_id", "reporter_user_id");

CREATE INDEX "bookings_player_user_id_starts_at_idx" ON "bookings"("player_user_id", "starts_at");

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_player_user_id_fkey" FOREIGN KEY ("player_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "player_profiles" ADD CONSTRAINT "player_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "player_favorites" ADD CONSTRAINT "player_favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "player_favorites" ADD CONSTRAINT "player_favorites_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reviews" ADD CONSTRAINT "reviews_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reviews" ADD CONSTRAINT "reviews_tenant_id_booking_id_fkey" FOREIGN KEY ("tenant_id", "booking_id") REFERENCES "bookings"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reviews" ADD CONSTRAINT "reviews_player_user_id_fkey" FOREIGN KEY ("player_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_tenant_id_review_id_fkey" FOREIGN KEY ("tenant_id", "review_id") REFERENCES "reviews"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_daily_views" ADD CONSTRAINT "tenant_daily_views_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------- Restricciones (= validaciones de la app)
ALTER TABLE "tenants"
  ADD CONSTRAINT "tenants_city_len" CHECK ("city" IS NULL OR char_length("city") BETWEEN 2 AND 80),
  ADD CONSTRAINT "tenants_deposit_type" CHECK ("deposit_type" IN ('NONE', 'PERCENT', 'FIXED')),
  ADD CONSTRAINT "tenants_deposit_value" CHECK ("deposit_value" >= 0 AND "deposit_value" <= 100000000
      AND ("deposit_type" <> 'PERCENT' OR "deposit_value" <= 100)),
  ADD CONSTRAINT "tenants_deposit_note_len" CHECK ("deposit_note" IS NULL OR char_length("deposit_note") <= 300);
ALTER TABLE "courts"
  ADD CONSTRAINT "courts_surface" CHECK ("surface" IS NULL OR "surface" IN ('SINTETICO', 'CESPED', 'CEMENTO', 'PARQUET', 'POLVO_LADRILLO', 'OTRA')),
  ADD CONSTRAINT "courts_dimensions_len" CHECK ("dimensions" IS NULL OR char_length("dimensions") <= 40);
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_origin" CHECK ("origin" IS NULL OR "origin" IN ('MARKETPLACE', 'DIRECT'));
ALTER TABLE "player_profiles"
  ADD CONSTRAINT "player_profiles_phone_len" CHECK ("phone" IS NULL OR char_length("phone") <= 30),
  ADD CONSTRAINT "player_profiles_city_len" CHECK ("city" IS NULL OR char_length("city") <= 80),
  ADD CONSTRAINT "player_profiles_sports" CHECK (cardinality("favorite_sports") <= 6),
  ADD CONSTRAINT "player_profiles_avatar_size" CHECK ("avatar" IS NULL OR octet_length("avatar") <= 300000);
ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_rating" CHECK ("rating" BETWEEN 1 AND 5),
  ADD CONSTRAINT "reviews_comment_len" CHECK ("comment" IS NULL OR char_length("comment") <= 1000),
  ADD CONSTRAINT "reviews_reply_len" CHECK ("reply" IS NULL OR char_length("reply") <= 1000),
  ADD CONSTRAINT "reviews_status" CHECK ("status" IN ('PUBLISHED', 'HIDDEN'));
ALTER TABLE "review_reports"
  ADD CONSTRAINT "review_reports_kind" CHECK ("reporter_kind" IN ('COMPLEX', 'PLAYER')),
  ADD CONSTRAINT "review_reports_reason_len" CHECK (char_length("reason") BETWEEN 3 AND 300);
ALTER TABLE "tenant_daily_views"
  ADD CONSTRAINT "tenant_daily_views_nonneg" CHECK ("views" >= 0);

-- ---------------------------------------------------------------- Contexto del jugador
-- Variable PROPIA (app.player_id), distinta de app.user_id: así, dentro del contexto de un
-- complejo, un empleado que además es jugador no "ve" sus datos de jugador ni viceversa.
CREATE FUNCTION app_player_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.player_id', true), '')::uuid $$;

-- ---------------------------------------------------------------- RLS
ALTER TABLE "player_profiles" ENABLE ROW LEVEL SECURITY;
CREATE POLICY player_own ON "player_profiles"
  USING ("user_id" = app_player_id() OR app_is_platform_admin())
  WITH CHECK ("user_id" = app_player_id() OR app_is_platform_admin());
ALTER TABLE "player_favorites" ENABLE ROW LEVEL SECURITY;
CREATE POLICY player_own ON "player_favorites"
  USING ("user_id" = app_player_id() OR app_is_platform_admin())
  WITH CHECK ("user_id" = app_player_id() OR app_is_platform_admin());
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['reviews', 'review_reports', 'tenant_daily_views'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = app_current_tenant_id() OR app_is_platform_admin())
         WITH CHECK (tenant_id = app_current_tenant_id() OR app_is_platform_admin())', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------- Funciones públicas (solo datos públicos)
-- Catálogo de complejos publicados: lo mismo que ya muestra cada ficha pública.
CREATE FUNCTION app_public_catalog(p_limit integer)
  RETURNS TABLE (
    id uuid, slug text, name text, city text, address text, sports text[], court_count integer,
    logo_asset_id uuid, cover_asset_id uuid, min_hour_price integer, currency text, services text[],
    rating_avg numeric, rating_count integer, has_covered boolean, deposit_type text
  )
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT t.id, t.slug, t.name, t.city, t.address,
         ARRAY(SELECT DISTINCT c.sport::text FROM courts c WHERE c.tenant_id = t.id AND c.is_active ORDER BY 1),
         (SELECT count(*)::integer FROM courts c WHERE c.tenant_id = t.id AND c.is_active),
         (SELECT a.id FROM tenant_assets a WHERE a.tenant_id = t.id AND a.kind = 'LOGO' ORDER BY a.created_at DESC LIMIT 1),
         (SELECT a.id FROM tenant_assets a WHERE a.tenant_id = t.id AND a.kind = 'COVER' ORDER BY a.created_at DESC LIMIT 1),
         (SELECT min(r.amount * 60 / r.duration_minutes)::integer FROM court_price_rules r JOIN courts c ON c.tenant_id = r.tenant_id AND c.id = r.court_id
           WHERE r.tenant_id = t.id AND c.is_active AND r.special_date IS NULL),
         t.currency::text, t.services,
         (SELECT round(avg(v.rating)::numeric, 1) FROM reviews v WHERE v.tenant_id = t.id AND v.status = 'PUBLISHED'),
         (SELECT count(*)::integer FROM reviews v WHERE v.tenant_id = t.id AND v.status = 'PUBLISHED'),
         EXISTS (SELECT 1 FROM courts c WHERE c.tenant_id = t.id AND c.is_active AND c.covered),
         t.deposit_type
    FROM tenants t
   WHERE t.status = 'ACTIVE' AND t.public_listed
     AND EXISTS (SELECT 1 FROM courts c WHERE c.tenant_id = t.id AND c.is_active)
   ORDER BY t.name
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)
$$;

-- Opiniones publicadas de un complejo: autor abreviado ("Juan P."), sin emails ni teléfonos.
CREATE FUNCTION app_public_reviews(p_slug text, p_limit integer)
  RETURNS TABLE (id uuid, rating smallint, comment text, reply text, replied_at timestamptz, created_at timestamptz, author text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT v.id, v.rating, v.comment, v.reply, v.replied_at, v.created_at,
         trim(split_part(b.customer_name, ' ', 1) || ' ' ||
              CASE WHEN split_part(b.customer_name, ' ', 2) <> '' THEN left(split_part(b.customer_name, ' ', 2), 1) || '.' ELSE '' END)
    FROM reviews v
    JOIN tenants t ON t.id = v.tenant_id
    JOIN bookings b ON b.tenant_id = v.tenant_id AND b.id = v.booking_id
   WHERE t.slug = lower(p_slug) AND t.status = 'ACTIVE' AND v.status = 'PUBLISHED'
   ORDER BY v.created_at DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
$$;

-- Reservas del jugador en TODOS los complejos (solo las suyas: app.player_id).
CREATE FUNCTION app_player_bookings(p_limit integer)
  RETURNS TABLE (
    id uuid, tenant_id uuid, code text, status text, starts_at timestamptz, ends_at timestamptz, duration_minutes integer,
    price_amount integer, currency text, tenant_slug text, tenant_name text, tenant_address text, tenant_timezone text,
    cancellation_minutes integer, court_name text, sport text, review_rating smallint
  )
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT b.id, b.tenant_id, b.code, b.status::text, b.starts_at, b.ends_at, b.duration_minutes, b.price_amount, b.currency::text,
         t.slug, t.name, t.address, t.timezone, t.public_cancellation_minutes, c.name, c.sport::text,
         (SELECT v.rating FROM reviews v WHERE v.tenant_id = b.tenant_id AND v.booking_id = b.id)
    FROM bookings b
    JOIN tenants t ON t.id = b.tenant_id
    JOIN courts c ON c.tenant_id = b.tenant_id AND c.id = b.court_id
   WHERE app_player_id() IS NOT NULL AND b.player_user_id = app_player_id()
   ORDER BY b.starts_at DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
$$;

-- Registra una visita a la ficha pública (contador diario; sin IP ni datos personales).
CREATE FUNCTION app_track_profile_view(p_slug text) RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO tenant_daily_views (tenant_id, day, views)
  SELECT t.id, (now() AT TIME ZONE t.timezone)::date, 1 FROM tenants t WHERE t.slug = lower(p_slug) AND t.status = 'ACTIVE'
  ON CONFLICT (tenant_id, day) DO UPDATE SET views = tenant_daily_views.views + 1
$$;

REVOKE EXECUTE ON FUNCTION app_public_catalog(integer), app_public_reviews(text, integer), app_player_bookings(integer), app_track_profile_view(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_public_catalog(integer), app_public_reviews(text, integer), app_player_bookings(integer), app_track_profile_view(text) TO app_runtime;

-- ---------------------------------------------------------------- Permisos del rol de la app
GRANT SELECT, INSERT, UPDATE, DELETE ON "player_profiles" TO app_runtime;
GRANT SELECT, INSERT, DELETE ON "player_favorites" TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON "reviews" TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON "review_reports" TO app_runtime;
GRANT SELECT ON "tenant_daily_views" TO app_runtime;
