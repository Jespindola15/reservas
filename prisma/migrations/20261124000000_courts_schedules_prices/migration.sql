-- =============================================================================
-- Fase 2 · Bloque A: canchas, horarios y precios.
-- Base generada con `prisma migrate diff`; el cambio de enum se reescribió a mano
-- para MAPEAR datos existentes (FOOTBALL -> FOOTBALL_5) en lugar de fallar.
-- =============================================================================

CREATE TYPE "ScheduleExceptionKind" AS ENUM ('CLOSED', 'SPECIAL_HOURS');

-- Deportes específicos. Preserva las filas existentes.
CREATE TYPE "SportType_new" AS ENUM ('FOOTBALL_5', 'FOOTBALL_7', 'FOOTBALL_11', 'PADEL');
ALTER TABLE "courts" ALTER COLUMN "sport" TYPE "SportType_new" USING (
  CASE "sport"::text WHEN 'FOOTBALL' THEN 'FOOTBALL_5' ELSE "sport"::text END
)::"SportType_new";
ALTER TYPE "SportType" RENAME TO "SportType_old";
ALTER TYPE "SportType_new" RENAME TO "SportType";
DROP TYPE "SportType_old";

ALTER TABLE "court_price_rules" ADD COLUMN "special_date" DATE;

ALTER TABLE "courts"
  ADD COLUMN "base_price" INTEGER,
  ADD COLUMN "capacity" INTEGER;

ALTER TABLE "tenants"
  ADD COLUMN "pending_expiration_minutes" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "public_cancellation_minutes" INTEGER NOT NULL DEFAULT 120;

CREATE TABLE "schedule_exceptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "court_id" UUID,
    "date" DATE NOT NULL,
    "kind" "ScheduleExceptionKind" NOT NULL,
    "open_minute" INTEGER,
    "close_minute" INTEGER,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "schedule_exceptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "court_images" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "court_id" UUID NOT NULL,
    "content_type" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "court_images_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "schedule_exceptions_tenant_id_date_idx" ON "schedule_exceptions"("tenant_id", "date");
CREATE INDEX "court_images_tenant_id_court_id_idx" ON "court_images"("tenant_id", "court_id");

ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_tenant_id_court_id_fkey" FOREIGN KEY ("tenant_id", "court_id") REFERENCES "courts"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "court_images" ADD CONSTRAINT "court_images_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "court_images" ADD CONSTRAINT "court_images_tenant_id_court_id_fkey" FOREIGN KEY ("tenant_id", "court_id") REFERENCES "courts"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------- CHECKs
ALTER TABLE "courts"
  ADD CONSTRAINT "courts_capacity_range" CHECK ("capacity" IS NULL OR "capacity" BETWEEN 1 AND 50),
  ADD CONSTRAINT "courts_base_price_non_negative" CHECK ("base_price" IS NULL OR "base_price" >= 0),
  ADD CONSTRAINT "courts_name_length" CHECK (char_length("name") BETWEEN 1 AND 80);

ALTER TABLE "tenants"
  ADD CONSTRAINT "tenants_pending_expiration_range" CHECK ("pending_expiration_minutes" BETWEEN 5 AND 1440),
  ADD CONSTRAINT "tenants_public_cancellation_range" CHECK ("public_cancellation_minutes" BETWEEN 0 AND 10080);

ALTER TABLE "schedule_exceptions"
  ADD CONSTRAINT "exceptions_hours_valid" CHECK (
    ("kind" = 'CLOSED' AND "open_minute" IS NULL AND "close_minute" IS NULL)
    OR ("kind" = 'SPECIAL_HOURS' AND "open_minute" BETWEEN 0 AND 1439
        AND "close_minute" > "open_minute" AND "close_minute" <= "open_minute" + 1440)
  ),
  ADD CONSTRAINT "exceptions_reason_length" CHECK (char_length("reason") BETWEEN 2 AND 200);

ALTER TABLE "court_images"
  ADD CONSTRAINT "court_images_type" CHECK ("content_type" IN ('image/jpeg', 'image/png', 'image/webp')),
  ADD CONSTRAINT "court_images_size" CHECK ("size_bytes" BETWEEN 1 AND 1572864 AND octet_length("data") = "size_bytes");

-- --------------------------------------------------- RLS + permisos (mínimo privilegio)
ALTER TABLE "schedule_exceptions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "schedule_exceptions"
  USING (tenant_id = app_current_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_current_tenant_id() OR app_is_platform_admin());

ALTER TABLE "court_images" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "court_images"
  USING (tenant_id = app_current_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_current_tenant_id() OR app_is_platform_admin());

REVOKE ALL ON "schedule_exceptions", "court_images" FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON "schedule_exceptions", "court_images" TO app_runtime;
