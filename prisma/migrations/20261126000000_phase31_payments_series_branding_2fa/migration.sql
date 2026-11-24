-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'TRANSFER', 'CARD', 'MERCADOPAGO_MANUAL', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('DEPOSIT', 'PAYMENT', 'REFUND');

-- CreateEnum
CREATE TYPE "SeriesStatus" AS ENUM ('ACTIVE', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TenantAssetKind" AS ENUM ('LOGO', 'COVER', 'GALLERY');

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "series_id" UUID;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "brand_color" TEXT,
ADD COLUMN     "cancellation_policy" TEXT,
ADD COLUMN     "facebook" TEXT,
ADD COLUMN     "instagram" TEXT,
ADD COLUMN     "onboarding_completed_at" TIMESTAMPTZ(3),
ADD COLUMN     "onboarding_step" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "services" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "website" TEXT,
ADD COLUMN     "whatsapp" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "two_factor_enabled" BOOLEAN DEFAULT false;

-- CreateTable
CREATE TABLE "two_factors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "secret" TEXT NOT NULL,
    "backup_codes" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "verified" BOOLEAN DEFAULT true,
    "failed_verification_count" INTEGER DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),

    CONSTRAINT "two_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "kind" "PaymentKind" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" INTEGER NOT NULL,
    "note" TEXT,
    "paid_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recorded_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_series" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "court_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "status" "SeriesStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_assets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "kind" "TenantAssetKind" NOT NULL,
    "storage" "ImageStorage" NOT NULL DEFAULT 'DATABASE',
    "data" BYTEA,
    "object_key" TEXT,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "subscription_id" UUID,
    "amount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'ARS',
    "method" "PaymentMethod" NOT NULL,
    "paid_at" TIMESTAMPTZ(3) NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "note" TEXT,
    "external_provider" TEXT,
    "external_id" TEXT,
    "recorded_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "two_factors_user_id_idx" ON "two_factors"("user_id");

-- CreateIndex
CREATE INDEX "two_factors_secret_idx" ON "two_factors"("secret");

-- CreateIndex
CREATE INDEX "booking_payments_tenant_id_paid_at_idx" ON "booking_payments"("tenant_id", "paid_at");

-- CreateIndex
CREATE INDEX "booking_payments_booking_id_idx" ON "booking_payments"("booking_id");

-- CreateIndex
CREATE INDEX "booking_series_tenant_id_status_idx" ON "booking_series"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "booking_series_tenant_id_id_key" ON "booking_series"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "tenant_assets_tenant_id_kind_sort_order_idx" ON "tenant_assets"("tenant_id", "kind", "sort_order");

-- CreateIndex
CREATE INDEX "subscription_payments_tenant_id_paid_at_idx" ON "subscription_payments"("tenant_id", "paid_at");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_payments_external_provider_external_id_key" ON "subscription_payments"("external_provider", "external_id");

-- CreateIndex
CREATE INDEX "bookings_tenant_id_series_id_idx" ON "bookings"("tenant_id", "series_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_tenant_id_id_key" ON "bookings"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "two_factors" ADD CONSTRAINT "two_factors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tenant_id_series_id_fkey" FOREIGN KEY ("tenant_id", "series_id") REFERENCES "booking_series"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_payments" ADD CONSTRAINT "booking_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_payments" ADD CONSTRAINT "booking_payments_tenant_id_booking_id_fkey" FOREIGN KEY ("tenant_id", "booking_id") REFERENCES "bookings"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_series" ADD CONSTRAINT "booking_series_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_series" ADD CONSTRAINT "booking_series_tenant_id_court_id_fkey" FOREIGN KEY ("tenant_id", "court_id") REFERENCES "courts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_series" ADD CONSTRAINT "booking_series_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_assets" ADD CONSTRAINT "tenant_assets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- =============================================================================
-- Fase 3.1 — integridad, RLS y permisos (todo aditivo; no modifica datos existentes)
-- =============================================================================

-- Integridad
ALTER TABLE "booking_payments"
  ADD CONSTRAINT "booking_payments_amount_positive" CHECK ("amount" > 0 AND "amount" <= 100000000),
  ADD CONSTRAINT "booking_payments_note_len" CHECK ("note" IS NULL OR char_length("note") <= 300);
ALTER TABLE "booking_series"
  ADD CONSTRAINT "booking_series_weekday" CHECK ("weekday" BETWEEN 1 AND 7),
  ADD CONSTRAINT "booking_series_start_minute" CHECK ("start_minute" BETWEEN 0 AND 2879),
  ADD CONSTRAINT "booking_series_duration" CHECK ("duration_minutes" BETWEEN 15 AND 720),
  ADD CONSTRAINT "booking_series_range" CHECK ("ends_on" >= "starts_on" AND "ends_on" <= "starts_on" + 366);
ALTER TABLE "tenant_assets"
  ADD CONSTRAINT "tenant_assets_location" CHECK (("storage" = 'DATABASE' AND "data" IS NOT NULL) OR ("storage" = 'OBJECT' AND "object_key" IS NOT NULL)),
  ADD CONSTRAINT "tenant_assets_size" CHECK ("size_bytes" > 0 AND "size_bytes" <= 2000000),
  ADD CONSTRAINT "tenant_assets_type" CHECK ("content_type" IN ('image/webp', 'image/png', 'image/jpeg'));
ALTER TABLE "subscription_payments"
  ADD CONSTRAINT "subscription_payments_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "subscription_payments_period" CHECK ("period_end" >= "period_start");
ALTER TABLE "tenants"
  ADD CONSTRAINT "tenants_brand_color_hex" CHECK ("brand_color" IS NULL OR "brand_color" ~ '^#[0-9a-fA-F]{6}$'),
  ADD CONSTRAINT "tenants_onboarding_step" CHECK ("onboarding_step" BETWEEN 0 AND 7),
  ADD CONSTRAINT "tenants_services_count" CHECK (cardinality("services") <= 20);

-- Seguridad por complejo
ALTER TABLE "booking_payments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "booking_payments"
  USING (tenant_id = app_current_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_current_tenant_id() OR app_is_platform_admin());
ALTER TABLE "booking_series" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "booking_series"
  USING (tenant_id = app_current_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_current_tenant_id() OR app_is_platform_admin());
ALTER TABLE "tenant_assets" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenant_assets"
  USING (tenant_id = app_current_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_current_tenant_id() OR app_is_platform_admin());
-- Cobros de suscripción: el complejo puede verlos; solo la plataforma los registra.
ALTER TABLE "subscription_payments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY subscription_payments_read ON "subscription_payments" FOR SELECT
  USING (tenant_id = app_current_tenant_id() OR app_is_platform_admin());
CREATE POLICY subscription_payments_write ON "subscription_payments" FOR ALL
  USING (app_is_platform_admin()) WITH CHECK (app_is_platform_admin());

-- Permisos mínimos del rol de la aplicación
REVOKE ALL ON "two_factors", "booking_payments", "booking_series", "tenant_assets", "subscription_payments" FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON "two_factors" TO app_runtime;
-- Los pagos registrados no se editan: se anulan (borrado auditado) y se cargan de nuevo.
GRANT SELECT, INSERT, DELETE ON "booking_payments" TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON "booking_series" TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant_assets" TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON "subscription_payments" TO app_runtime;
