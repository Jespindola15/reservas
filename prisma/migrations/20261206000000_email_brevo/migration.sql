-- Fase 6: correos transaccionales con Brevo.
-- Solo AGREGA columnas e índices (compatible con la versión anterior en el intervalo entre migrar y desplegar).

-- ---------------------------------------------------------------- Cola de correos (notifications)
-- Prioridad para el cupo diario del plan gratuito: 1 = crítico (contraseña, verificación) … 5 = recordatorios/bienvenidas.
ALTER TABLE "notifications"
  ADD COLUMN "priority" SMALLINT NOT NULL DEFAULT 3,
  -- Proveedor que ACEPTÓ el envío (brevo, resend, log…).
  ADD COLUMN "provider" TEXT,
  -- Estado de ENTREGA informado por el webhook del proveedor (aceptado ≠ entregado).
  ADD COLUMN "delivery_status" TEXT,
  ADD COLUMN "delivery_updated_at" TIMESTAMPTZ(3);

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_priority" CHECK ("priority" BETWEEN 1 AND 5),
  ADD CONSTRAINT "notifications_provider" CHECK ("provider" IS NULL OR "provider" ~ '^[a-z]{2,20}$'),
  ADD CONSTRAINT "notifications_delivery_status" CHECK ("delivery_status" IS NULL OR "delivery_status" IN
    ('delivered', 'deferred', 'soft_bounce', 'hard_bounce', 'blocked', 'invalid', 'spam', 'unsubscribed', 'error', 'opened', 'clicked'));

-- Cola por prioridad y búsquedas del panel / webhook.
CREATE INDEX "notifications_queue_idx" ON "notifications" ("status", "priority", "next_attempt_at");
CREATE INDEX "notifications_sent_at_idx" ON "notifications" ("sent_at");
CREATE INDEX "notifications_provider_message_id_idx" ON "notifications" ("provider_message_id");

-- ---------------------------------------------------------------- Avisos operativos por complejo
-- Tipos de aviso al complejo que el complejo NO quiere recibir por email (vacío = todos).
ALTER TABLE "tenants" ADD COLUMN "owner_email_muted" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_owner_email_muted" CHECK (
  "owner_email_muted" <@ ARRAY['owner_new_request', 'owner_transfer_reported', 'owner_transfer_expiring', 'owner_booking_cancelled', 'owner_payment_incident', 'owner_subscription_notice']::text[]
);

-- Los recordatorios nuevos llevan números en el tipo (booking_reminder_24h / _2h).
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind" CHECK ("kind" ~ '^[a-z][a-z0-9_]{2,39}$');
