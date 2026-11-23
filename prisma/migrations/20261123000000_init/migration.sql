-- =============================================================================
-- PARTE 1 — Generado con: prisma migrate diff --from-empty --to-schema
-- (única edición manual: columna generada court_allocations.period)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('USER', 'SUPERADMIN');

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'ADMIN', 'STAFF');

-- CreateEnum
CREATE TYPE "SportType" AS ENUM ('FOOTBALL', 'PADEL');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'REJECTED', 'COMPLETED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('ONLINE', 'MANUAL');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'PLATFORM_ADMIN', 'PUBLIC', 'SYSTEM');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "platform_role" "PlatformRole" NOT NULL DEFAULT 'USER',
    "is_disabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "user_id" UUID NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "access_token_expires_at" TIMESTAMPTZ(3),
    "refresh_token_expires_at" TIMESTAMPTZ(3),
    "scope" TEXT,
    "password" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limits" (
    "key" TEXT NOT NULL,
    "window_start" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "logo_url" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
    "currency" CHAR(3) NOT NULL DEFAULT 'ARS',
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "booking_requires_approval" BOOLEAN NOT NULL DEFAULT true,
    "min_lead_minutes" INTEGER NOT NULL DEFAULT 60,
    "max_advance_days" INTEGER NOT NULL DEFAULT 30,
    "contact_phone" TEXT,
    "contact_email" TEXT,
    "address" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price_amount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'ARS',
    "max_courts" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "current_period_start" TIMESTAMPTZ(3) NOT NULL,
    "current_period_end" TIMESTAMPTZ(3) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sport" "SportType" NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "slot_step_minutes" INTEGER NOT NULL DEFAULT 30,
    "allowed_durations" INTEGER[] DEFAULT ARRAY[60, 90, 120]::INTEGER[],
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "court_schedule_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "court_id" UUID NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "open_minute" INTEGER NOT NULL,
    "close_minute" INTEGER NOT NULL,

    CONSTRAINT "court_schedule_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "court_price_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "court_id" UUID NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "weekday" SMALLINT,
    "start_minute" INTEGER,
    "end_minute" INTEGER,
    "amount" INTEGER NOT NULL,

    CONSTRAINT "court_price_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "contact_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "court_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "status" "BookingStatus" NOT NULL,
    "source" "BookingSource" NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "price_amount" INTEGER,
    "currency" CHAR(3) NOT NULL,
    "customer_name" TEXT NOT NULL,
    "customer_phone" TEXT,
    "customer_email" TEXT,
    "notes" TEXT,
    "idempotency_key" TEXT,
    "request_fingerprint" TEXT,
    "created_by_user_id" UUID,
    "confirmed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_blocks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "court_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "availability_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "court_allocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "court_id" UUID NOT NULL,
    "booking_id" UUID,
    "block_id" UUID,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "period" tstzrange GENERATED ALWAYS AS (tstzrange("starts_at", "ends_at", '[)')) STORED,

    CONSTRAINT "court_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID,
    "actor_type" "ActorType" NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");

-- CreateIndex
CREATE INDEX "verifications_identifier_idx" ON "verifications"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_tenant_id_user_id_key" ON "memberships"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE INDEX "subscriptions_tenant_id_idx" ON "subscriptions"("tenant_id");

-- CreateIndex
CREATE INDEX "courts_tenant_id_idx" ON "courts"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "courts_tenant_id_id_key" ON "courts"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "court_schedule_rules_tenant_id_court_id_idx" ON "court_schedule_rules"("tenant_id", "court_id");

-- CreateIndex
CREATE INDEX "court_price_rules_tenant_id_court_id_idx" ON "court_price_rules"("tenant_id", "court_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenant_id_id_key" ON "customers"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenant_id_contact_key_key" ON "customers"("tenant_id", "contact_key");

-- CreateIndex
CREATE INDEX "bookings_tenant_id_starts_at_idx" ON "bookings"("tenant_id", "starts_at");

-- CreateIndex
CREATE INDEX "bookings_court_id_starts_at_idx" ON "bookings"("court_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_tenant_id_code_key" ON "bookings"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_tenant_id_idempotency_key_key" ON "bookings"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "availability_blocks_tenant_id_starts_at_idx" ON "availability_blocks"("tenant_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "court_allocations_booking_id_key" ON "court_allocations"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "court_allocations_block_id_key" ON "court_allocations"("block_id");

-- CreateIndex
CREATE INDEX "court_allocations_tenant_id_starts_at_idx" ON "court_allocations"("tenant_id", "starts_at");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courts" ADD CONSTRAINT "courts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "court_schedule_rules" ADD CONSTRAINT "court_schedule_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "court_schedule_rules" ADD CONSTRAINT "court_schedule_rules_tenant_id_court_id_fkey" FOREIGN KEY ("tenant_id", "court_id") REFERENCES "courts"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "court_price_rules" ADD CONSTRAINT "court_price_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "court_price_rules" ADD CONSTRAINT "court_price_rules_tenant_id_court_id_fkey" FOREIGN KEY ("tenant_id", "court_id") REFERENCES "courts"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tenant_id_court_id_fkey" FOREIGN KEY ("tenant_id", "court_id") REFERENCES "courts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_tenant_id_court_id_fkey" FOREIGN KEY ("tenant_id", "court_id") REFERENCES "courts"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "court_allocations" ADD CONSTRAINT "court_allocations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "court_allocations" ADD CONSTRAINT "court_allocations_tenant_id_court_id_fkey" FOREIGN KEY ("tenant_id", "court_id") REFERENCES "courts"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "court_allocations" ADD CONSTRAINT "court_allocations_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "court_allocations" ADD CONSTRAINT "court_allocations_block_id_fkey" FOREIGN KEY ("block_id") REFERENCES "availability_blocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- =============================================================================
-- PARTE 2 — SQL que Prisma no puede expresar. Escrito y revisado a mano.
-- =============================================================================

-- Requisito: el rol de grupo app_runtime debe existir (lo crea db/bootstrap.sql,
-- que corre un superusuario una sola vez por servidor).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    RAISE EXCEPTION 'Falta el rol app_runtime. Ejecutá db/bootstrap.sql como superusuario antes de migrar.';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2.1 Restricciones CHECK (integridad básica en la base, no solo en JavaScript)
-- -----------------------------------------------------------------------------

ALTER TABLE "tenants"
  ADD CONSTRAINT "tenants_slug_format" CHECK ("slug" ~ '^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])$'),
  ADD CONSTRAINT "tenants_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "tenants_min_lead_range" CHECK ("min_lead_minutes" BETWEEN 0 AND 10080),
  ADD CONSTRAINT "tenants_max_advance_range" CHECK ("max_advance_days" BETWEEN 1 AND 365);

ALTER TABLE "courts"
  ADD CONSTRAINT "courts_slot_step_range" CHECK ("slot_step_minutes" BETWEEN 5 AND 240),
  ADD CONSTRAINT "courts_allowed_durations_valid" CHECK (
    cardinality("allowed_durations") BETWEEN 1 AND 10
    AND 15 <= ALL ("allowed_durations")
    AND 720 >= ALL ("allowed_durations")
  );

ALTER TABLE "court_schedule_rules"
  ADD CONSTRAINT "schedule_weekday_range" CHECK ("weekday" BETWEEN 1 AND 7),
  ADD CONSTRAINT "schedule_open_range" CHECK ("open_minute" BETWEEN 0 AND 1439),
  -- close_minute > 1440 significa que la franja termina después de medianoche.
  ADD CONSTRAINT "schedule_close_range" CHECK ("close_minute" > "open_minute" AND "close_minute" <= "open_minute" + 1440);

ALTER TABLE "court_price_rules"
  ADD CONSTRAINT "price_amount_non_negative" CHECK ("amount" >= 0),
  ADD CONSTRAINT "price_duration_range" CHECK ("duration_minutes" BETWEEN 15 AND 720),
  ADD CONSTRAINT "price_weekday_range" CHECK ("weekday" IS NULL OR "weekday" BETWEEN 1 AND 7),
  ADD CONSTRAINT "price_band_valid" CHECK (
    ("start_minute" IS NULL AND "end_minute" IS NULL)
    OR ("start_minute" >= 0 AND "end_minute" > "start_minute" AND "end_minute" <= 2880)
  );

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_time_order" CHECK ("ends_at" > "starts_at"),
  ADD CONSTRAINT "bookings_duration_range" CHECK ("duration_minutes" BETWEEN 15 AND 720),
  ADD CONSTRAINT "bookings_duration_matches" CHECK ("ends_at" - "starts_at" = make_interval(mins => "duration_minutes")),
  ADD CONSTRAINT "bookings_price_non_negative" CHECK ("price_amount" IS NULL OR "price_amount" >= 0),
  ADD CONSTRAINT "bookings_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "bookings_code_format" CHECK ("code" ~ '^[A-Z0-9]{6,12}$');

ALTER TABLE "availability_blocks"
  ADD CONSTRAINT "blocks_time_order" CHECK ("ends_at" > "starts_at"),
  ADD CONSTRAINT "blocks_max_length" CHECK ("ends_at" - "starts_at" <= interval '31 days');

ALTER TABLE "court_allocations"
  ADD CONSTRAINT "allocations_time_order" CHECK ("ends_at" > "starts_at"),
  ADD CONSTRAINT "allocations_single_source" CHECK (num_nonnulls("booking_id", "block_id") = 1);

-- -----------------------------------------------------------------------------
-- 2.2 Antisolapamiento: la última barrera
-- Dos ocupaciones de la misma cancha nunca pueden intersectarse. Intervalos
-- semiabiertos [inicio, fin): 20:00-21:30 y 21:30-23:00 NO se solapan.
-- -----------------------------------------------------------------------------

ALTER TABLE "court_allocations"
  ADD CONSTRAINT "court_allocations_no_overlap"
  EXCLUDE USING gist ("court_id" WITH =, "period" WITH &&);

-- Estados que ocupan la cancha. COMPLETED/NO_SHOW siguen ocupando (son historia).
CREATE FUNCTION app_booking_occupies(s "BookingStatus") RETURNS boolean
  LANGUAGE sql IMMUTABLE AS $$ SELECT s IN ('PENDING', 'CONFIRMED', 'COMPLETED', 'NO_SHOW') $$;

-- Los triggers son SECURITY DEFINER: el rol de la aplicación NO tiene permiso de
-- escritura directa sobre court_allocations, así que la ocupación solo puede
-- cambiar como consecuencia de una reserva o un bloqueo válidos.
CREATE FUNCTION app_sync_booking_allocation() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.starts_at = OLD.starts_at
       AND NEW.ends_at = OLD.ends_at
       AND NEW.court_id = OLD.court_id THEN
      RETURN NEW;
    END IF;
    DELETE FROM court_allocations WHERE booking_id = NEW.id;
  END IF;

  IF app_booking_occupies(NEW.status) THEN
    INSERT INTO court_allocations (tenant_id, court_id, booking_id, starts_at, ends_at)
    VALUES (NEW.tenant_id, NEW.court_id, NEW.id, NEW.starts_at, NEW.ends_at);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "bookings_sync_allocation"
  AFTER INSERT OR UPDATE OF status, starts_at, ends_at, court_id ON "bookings"
  FOR EACH ROW EXECUTE FUNCTION app_sync_booking_allocation();

CREATE FUNCTION app_sync_block_allocation() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    DELETE FROM court_allocations WHERE block_id = NEW.id;
  END IF;
  INSERT INTO court_allocations (tenant_id, court_id, block_id, starts_at, ends_at)
  VALUES (NEW.tenant_id, NEW.court_id, NEW.id, NEW.starts_at, NEW.ends_at);
  RETURN NEW;
END $$;

CREATE TRIGGER "blocks_sync_allocation"
  AFTER INSERT OR UPDATE OF starts_at, ends_at, court_id ON "availability_blocks"
  FOR EACH ROW EXECUTE FUNCTION app_sync_block_allocation();
-- El borrado de un bloqueo elimina su ocupación por ON DELETE CASCADE.

-- -----------------------------------------------------------------------------
-- 2.3 Contexto de sesión para Row Level Security
-- La aplicación fija estas variables con set_config(..., true), es decir,
-- SOLO dentro de la transacción actual (seguro con pools de conexiones).
-- -----------------------------------------------------------------------------

CREATE FUNCTION app_current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE FUNCTION app_current_user_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

CREATE FUNCTION app_is_platform_admin() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('app.platform_admin', true), '') = 'on' $$;

-- Resolución pública slug -> complejo, antes de tener contexto de tenant.
-- SECURITY DEFINER y devuelve SOLO id y estado (nada sensible).
CREATE FUNCTION app_resolve_tenant_slug(p_slug text)
  RETURNS TABLE (id uuid, status "TenantStatus")
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT t.id, t.status FROM tenants t WHERE t.slug = lower(p_slug)
$$;

-- -----------------------------------------------------------------------------
-- 2.4 Row Level Security (defensa en profundidad)
-- Sin contexto de tenant, el rol de la aplicación NO ve ni escribe nada.
-- -----------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'courts', 'court_schedule_rules', 'court_price_rules', 'customers',
    'bookings', 'availability_blocks', 'court_allocations', 'subscriptions'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = app_current_tenant_id() OR app_is_platform_admin())
         WITH CHECK (tenant_id = app_current_tenant_id() OR app_is_platform_admin())', t);
  END LOOP;
END $$;

ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON "tenants" FOR SELECT
  USING (id = app_current_tenant_id() OR app_is_platform_admin());
CREATE POLICY tenant_update ON "tenants" FOR UPDATE
  USING (id = app_current_tenant_id() OR app_is_platform_admin())
  WITH CHECK (id = app_current_tenant_id() OR app_is_platform_admin());
CREATE POLICY tenant_insert ON "tenants" FOR INSERT WITH CHECK (app_is_platform_admin());
CREATE POLICY tenant_delete ON "tenants" FOR DELETE USING (app_is_platform_admin());

ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
CREATE POLICY membership_read ON "memberships" FOR SELECT
  USING (tenant_id = app_current_tenant_id() OR user_id = app_current_user_id() OR app_is_platform_admin());
CREATE POLICY membership_write ON "memberships" FOR ALL
  USING (app_is_platform_admin()) WITH CHECK (app_is_platform_admin());

ALTER TABLE "plans" ENABLE ROW LEVEL SECURITY;
CREATE POLICY plans_read ON "plans" FOR SELECT USING (true);
CREATE POLICY plans_write ON "plans" FOR ALL
  USING (app_is_platform_admin()) WITH CHECK (app_is_platform_admin());

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON "audit_logs" FOR SELECT
  USING (tenant_id = app_current_tenant_id() OR app_is_platform_admin());
CREATE POLICY audit_insert ON "audit_logs" FOR INSERT
  WITH CHECK (tenant_id IS NULL OR tenant_id = app_current_tenant_id() OR app_is_platform_admin());

-- -----------------------------------------------------------------------------
-- 2.5 Permisos del rol de la aplicación (mínimo privilegio)
-- -----------------------------------------------------------------------------

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "users", "sessions", "accounts", "verifications", "rate_limits",
  "tenants", "memberships", "plans", "subscriptions",
  "courts", "court_schedule_rules", "court_price_rules",
  "customers", "bookings", "availability_blocks"
TO app_runtime;

-- La ocupación solo la escriben los triggers.
GRANT SELECT ON "court_allocations" TO app_runtime;
-- La auditoría es de solo inserción: la aplicación no puede alterar la historia.
GRANT SELECT, INSERT ON "audit_logs" TO app_runtime;

GRANT EXECUTE ON FUNCTION
  app_current_tenant_id(), app_current_user_id(), app_is_platform_admin(),
  app_resolve_tenant_slug(text), app_booking_occupies("BookingStatus")
TO app_runtime;
REVOKE EXECUTE ON FUNCTION app_sync_booking_allocation(), app_sync_block_allocation() FROM PUBLIC;
