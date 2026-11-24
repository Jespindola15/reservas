-- =============================================================================
-- Fase 3: equipos, notificaciones (outbox), operación y almacenamiento de imágenes.
-- Todos los cambios son ADITIVOS (sin DROP de datos): el código de la Fase 2
-- sigue funcionando si esta migración se aplica antes del deploy.
-- Parte 1 generada con prisma migrate diff; parte 2 escrita a mano.
-- =============================================================================

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ImageStorage" AS ENUM ('DATABASE', 'OBJECT');

-- AlterTable
ALTER TABLE "court_images" ADD COLUMN     "height" INTEGER,
ADD COLUMN     "object_key" TEXT,
ADD COLUMN     "storage" "ImageStorage" NOT NULL DEFAULT 'DATABASE',
ADD COLUMN     "width" INTEGER,
ALTER COLUMN "data" DROP NOT NULL;

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "description" TEXT,
ADD COLUMN     "max_members" INTEGER;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "digest_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "digest_hour" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "notifications_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notify_owner" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notify_players" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "owner_notification_email" TEXT,
ADD COLUMN     "reminder_hours_before" INTEGER NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "invited_by_user_id" UUID,
    "accepted_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID,
    "kind" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "booking_id" UUID,
    "payload" JSONB,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "provider_message_id" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "name" TEXT NOT NULL,
    "last_started_at" TIMESTAMPTZ(3),
    "last_finished_at" TIMESTAMPTZ(3),
    "last_success_at" TIMESTAMPTZ(3),
    "last_status" TEXT,
    "last_error" TEXT,
    "last_result" JSONB,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_tenant_id_created_at_idx" ON "invitations"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedupe_key_key" ON "notifications"("dedupe_key");

-- CreateIndex
CREATE INDEX "notifications_status_next_attempt_at_idx" ON "notifications"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_created_at_idx" ON "notifications"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- =============================================================================
-- PARTE 2 — CHECKs, RLS, permisos, guardias y funciones
-- =============================================================================

ALTER TABLE "court_images" DROP CONSTRAINT "court_images_size";
ALTER TABLE "court_images"
  ADD CONSTRAINT "court_images_size" CHECK ("size_bytes" BETWEEN 1 AND 1572864 AND ("data" IS NULL OR octet_length("data") = "size_bytes")),
  ADD CONSTRAINT "court_images_location" CHECK (
    ("storage" = 'DATABASE' AND "data" IS NOT NULL)
    OR ("storage" = 'OBJECT' AND "object_key" IS NOT NULL AND "object_key" ~ '^[a-z0-9/._-]{10,300}$')
  );

ALTER TABLE "tenants"
  ADD CONSTRAINT "tenants_reminder_range" CHECK ("reminder_hours_before" BETWEEN 0 AND 48),
  ADD CONSTRAINT "tenants_digest_hour_range" CHECK ("digest_hour" BETWEEN 0 AND 23);

ALTER TABLE "plans"
  ADD CONSTRAINT "plans_limits_positive" CHECK (("max_courts" IS NULL OR "max_courts" >= 1) AND ("max_members" IS NULL OR "max_members" >= 0));

ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_role" CHECK ("role" IN ('ADMIN', 'STAFF')),
  ADD CONSTRAINT "invitations_email" CHECK ("email" = lower("email") AND "email" LIKE '%@%');
-- Una sola invitación vigente por email y complejo.
CREATE UNIQUE INDEX "invitations_one_open_per_email" ON "invitations" ("tenant_id", "email")
  WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_attempts" CHECK ("attempts" BETWEEN 0 AND 20),
  ADD CONSTRAINT "notifications_kind" CHECK ("kind" ~ '^[a-z_]{3,40}$');

-- ---------------------------------------------------------------- RLS
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "invitations"
  USING (tenant_id = app_current_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_current_tenant_id() OR app_is_platform_admin());

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "notifications"
  USING (tenant_id = app_current_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_current_tenant_id() OR app_is_platform_admin());

ALTER TABLE "job_runs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_only ON "job_runs" USING (app_is_platform_admin()) WITH CHECK (app_is_platform_admin());

-- El complejo puede ACTUALIZAR membresías propias (rol, activo). Altas: solo plataforma
-- o aceptación de invitación (contexto de sistema).
CREATE POLICY membership_tenant_update ON "memberships" FOR UPDATE
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

-- ---------------------------------------------------------------- Guardia de permisos
-- Aunque la app tuviera un error, la base impide la escalada de privilegios:
--  - nadie cambia su PROPIA membresía;
--  - el rol OWNER solo lo otorga/modifica la plataforma;
--  - un ADMIN solo gestiona STAFF y no puede crear otros ADMIN;
--  - STAFF no gestiona a nadie.
CREATE FUNCTION app_guard_membership() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE actor_role "MembershipRole";
BEGIN
  IF app_is_platform_admin() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'membership_forbidden';
  END IF;
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.user_id <> OLD.user_id THEN
    RAISE EXCEPTION 'membership_forbidden';
  END IF;
  IF OLD.user_id = app_current_user_id() THEN
    RAISE EXCEPTION 'membership_self_change';
  END IF;
  IF OLD.role = 'OWNER' OR NEW.role = 'OWNER' THEN
    RAISE EXCEPTION 'membership_owner_forbidden';
  END IF;
  SELECT m.role INTO actor_role FROM memberships m
   WHERE m.tenant_id = NEW.tenant_id AND m.user_id = app_current_user_id() AND m.is_active;
  IF actor_role IS NULL OR actor_role = 'STAFF' THEN
    RAISE EXCEPTION 'membership_forbidden';
  END IF;
  IF actor_role = 'ADMIN' AND (OLD.role = 'ADMIN' OR NEW.role = 'ADMIN') THEN
    RAISE EXCEPTION 'membership_forbidden';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "memberships_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "memberships"
  FOR EACH ROW EXECUTE FUNCTION app_guard_membership();

-- ---------------------------------------------------------------- Vencimiento + aviso
-- Misma función de la Fase 2 (mismas garantías: SKIP LOCKED, idempotente,
-- auditada) y ahora también ENCOLA el aviso de vencimiento al jugador en la
-- misma sentencia. El envío decide al final si el complejo tiene avisos activos.
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
    RETURNING b.id, b.tenant_id, b.court_id, b.starts_at, b.expires_at, b.customer_email
  ), aud AS (
    INSERT INTO audit_logs (tenant_id, actor_type, action, entity_type, entity_id, metadata)
    SELECT upd.tenant_id, 'SYSTEM', 'booking.status.expired', 'booking', upd.id::text,
           jsonb_build_object('reason', 'pending_timeout', 'expiresAt', upd.expires_at,
                              'courtId', upd.court_id, 'startsAt', upd.starts_at)
      FROM upd
    RETURNING 1
  ), notif AS (
    INSERT INTO notifications (tenant_id, kind, recipient, dedupe_key, booking_id)
    SELECT upd.tenant_id, 'booking_expired', upd.customer_email, 'booking:' || upd.id || ':expired', upd.id
      FROM upd WHERE upd.customer_email IS NOT NULL
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING 1
  )
  SELECT upd.id, upd.tenant_id FROM upd;
END $$;

REVOKE EXECUTE ON FUNCTION app_expire_pending_bookings(integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_expire_pending_bookings(integer, uuid) TO app_runtime;

-- ---------------------------------------------------------------- Permisos
REVOKE ALL ON "invitations", "notifications", "job_runs" FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON "invitations", "notifications", "job_runs" TO app_runtime;
