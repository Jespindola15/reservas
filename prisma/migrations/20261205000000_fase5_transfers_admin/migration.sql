-- Fase 5: reservas por transferencia directa, incidencias de pago, notificaciones internas,
-- suspensión de usuarios/complejos. ADITIVA y compatible con la versión publicada.

ALTER TABLE "bookings" ADD COLUMN     "amount_due" INTEGER,
ADD COLUMN     "payment_status" TEXT,
ADD COLUMN     "payment_verified_at" TIMESTAMPTZ(3),
ADD COLUMN     "payment_verified_by" UUID,
ADD COLUMN     "review_alerted_at" TIMESTAMPTZ(3),
ADD COLUMN     "transfer_payer_name" TEXT,
ADD COLUMN     "transfer_reference" TEXT,
ADD COLUMN     "transfer_reported_at" TIMESTAMPTZ(3);

ALTER TABLE "tenants" ADD COLUMN     "archived_at" TIMESTAMPTZ(3),
ADD COLUMN     "suspended_reason" TEXT;

ALTER TABLE "users" ADD COLUMN     "anonymized_at" TIMESTAMPTZ(3),
ADD COLUMN     "suspended_at" TIMESTAMPTZ(3),
ADD COLUMN     "suspended_reason" TEXT;

CREATE TABLE "tenant_payment_settings" (
    "tenant_id" UUID NOT NULL,
    "alias" TEXT,
    "cbu_cvu" TEXT,
    "holder_name" TEXT,
    "bank_name" TEXT,
    "transfer_window_minutes" INTEGER NOT NULL DEFAULT 30,
    "review_window_minutes" INTEGER NOT NULL DEFAULT 180,
    "instructions" TEXT,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_payment_settings_pkey" PRIMARY KEY ("tenant_id")
);

CREATE TABLE "payment_incidents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "amount" INTEGER,
    "notes" TEXT,
    "resolution" TEXT,
    "created_by_user_id" UUID,
    "resolved_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "payment_incidents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inbox_notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID,
    "user_id" UUID,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "booking_id" UUID,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbox_notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payment_incidents_tenant_id_status_created_at_idx" ON "payment_incidents"("tenant_id", "status", "created_at");

CREATE INDEX "inbox_notifications_tenant_id_read_at_created_at_idx" ON "inbox_notifications"("tenant_id", "read_at", "created_at");

CREATE INDEX "inbox_notifications_user_id_read_at_created_at_idx" ON "inbox_notifications"("user_id", "read_at", "created_at");

ALTER TABLE "tenant_payment_settings" ADD CONSTRAINT "tenant_payment_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_incidents" ADD CONSTRAINT "payment_incidents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_incidents" ADD CONSTRAINT "payment_incidents_tenant_id_booking_id_fkey" FOREIGN KEY ("tenant_id", "booking_id") REFERENCES "bookings"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inbox_notifications" ADD CONSTRAINT "inbox_notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------- Restricciones
ALTER TABLE "tenants" DROP CONSTRAINT "tenants_deposit_type";
ALTER TABLE "tenants"
  ADD CONSTRAINT "tenants_deposit_type" CHECK ("deposit_type" IN ('NONE', 'PERCENT', 'FIXED', 'FULL')),
  ADD CONSTRAINT "tenants_suspended_reason_len" CHECK ("suspended_reason" IS NULL OR char_length("suspended_reason") <= 300);
ALTER TABLE "users"
  ADD CONSTRAINT "users_suspended_reason_len" CHECK ("suspended_reason" IS NULL OR char_length("suspended_reason") <= 300);
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_payment_status" CHECK ("payment_status" IS NULL OR "payment_status" IN ('NOT_REQUIRED', 'AWAITING_TRANSFER', 'TRANSFER_REPORTED', 'VERIFIED')),
  ADD CONSTRAINT "bookings_amount_due" CHECK ("amount_due" IS NULL OR "amount_due" BETWEEN 0 AND 100000000),
  ADD CONSTRAINT "bookings_transfer_payer_len" CHECK ("transfer_payer_name" IS NULL OR char_length("transfer_payer_name") BETWEEN 3 AND 80),
  ADD CONSTRAINT "bookings_transfer_reference_len" CHECK ("transfer_reference" IS NULL OR char_length("transfer_reference") BETWEEN 1 AND 60);
ALTER TABLE "tenant_payment_settings"
  ADD CONSTRAINT "tps_alias" CHECK ("alias" IS NULL OR "alias" ~ '^[A-Za-z0-9.-]{6,20}$'),
  ADD CONSTRAINT "tps_cbu" CHECK ("cbu_cvu" IS NULL OR "cbu_cvu" ~ '^[0-9]{22}$'),
  ADD CONSTRAINT "tps_holder_len" CHECK ("holder_name" IS NULL OR char_length("holder_name") BETWEEN 3 AND 80),
  ADD CONSTRAINT "tps_bank_len" CHECK ("bank_name" IS NULL OR char_length("bank_name") <= 60),
  ADD CONSTRAINT "tps_windows" CHECK ("transfer_window_minutes" BETWEEN 10 AND 1440 AND "review_window_minutes" BETWEEN 15 AND 2880),
  ADD CONSTRAINT "tps_instructions_len" CHECK ("instructions" IS NULL OR char_length("instructions") <= 500);
ALTER TABLE "payment_incidents"
  ADD CONSTRAINT "pi_kind" CHECK ("kind" IN ('LATE_TRANSFER', 'PAID_BUT_EXPIRED', 'PAID_BUT_REJECTED', 'REFUND', 'OTHER')),
  ADD CONSTRAINT "pi_status" CHECK ("status" IN ('OPEN', 'RESOLVED')),
  ADD CONSTRAINT "pi_resolution" CHECK ("resolution" IS NULL OR "resolution" IN ('REFUNDED_EXTERNALLY', 'RESCHEDULED', 'NO_PAYMENT_RECEIVED', 'OTHER')),
  ADD CONSTRAINT "pi_amount" CHECK ("amount" IS NULL OR "amount" BETWEEN 0 AND 100000000),
  ADD CONSTRAINT "pi_notes_len" CHECK ("notes" IS NULL OR char_length("notes") <= 500);
ALTER TABLE "inbox_notifications"
  ADD CONSTRAINT "inbox_audience" CHECK (("tenant_id" IS NOT NULL) <> ("user_id" IS NOT NULL)),
  ADD CONSTRAINT "inbox_title_len" CHECK (char_length("title") BETWEEN 1 AND 140),
  ADD CONSTRAINT "inbox_body_len" CHECK ("body" IS NULL OR char_length("body") <= 500),
  ADD CONSTRAINT "inbox_link" CHECK ("link" IS NULL OR "link" ~ '^/[A-Za-z0-9/_?=&.%-]*$');

-- Los jugadores ya no tienen foto de perfil: se borran las existentes (las columnas se eliminan
-- en una migración posterior, cuando la versión publicada ya no las use).
UPDATE "player_profiles" SET "avatar" = NULL, "avatar_updated_at" = NULL WHERE "avatar" IS NOT NULL OR "avatar_updated_at" IS NOT NULL;

-- Índice para la cola de transferencias del panel y para el vencimiento.
CREATE INDEX "bookings_payment_queue_idx" ON "bookings" ("tenant_id", "payment_status", "expires_at") WHERE "status" = 'PENDING';

-- ---------------------------------------------------------------- RLS
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_payment_settings', 'payment_incidents'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = app_current_tenant_id() OR app_is_platform_admin())
         WITH CHECK (tenant_id = app_current_tenant_id() OR app_is_platform_admin())', t);
  END LOOP;
END $$;
-- Bandeja: filas del complejo (contexto de complejo) o del jugador (contexto de jugador), nunca mezcladas.
ALTER TABLE "inbox_notifications" ENABLE ROW LEVEL SECURITY;
CREATE POLICY inbox_scope ON "inbox_notifications"
  USING ((tenant_id IS NOT NULL AND tenant_id = app_current_tenant_id())
      OR (user_id IS NOT NULL AND user_id = app_player_id())
      OR app_is_platform_admin())
  WITH CHECK ((tenant_id IS NOT NULL AND tenant_id = app_current_tenant_id())
      OR (user_id IS NOT NULL AND user_id = app_player_id())
      OR app_is_platform_admin());

-- ---------------------------------------------------------------- Permisos del rol de la app
GRANT SELECT, INSERT, UPDATE ON "tenant_payment_settings" TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON "payment_incidents" TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON "inbox_notifications" TO app_runtime;
