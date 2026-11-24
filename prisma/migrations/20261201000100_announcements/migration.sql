-- Fase 4: novedades/promociones publicadas por cada complejo (texto propio, con vencimiento).
ALTER TABLE "tenants" ADD COLUMN "announcement" TEXT,
ADD COLUMN "announcement_until" DATE;
ALTER TABLE "tenants"
  ADD CONSTRAINT "tenants_announcement_len" CHECK ("announcement" IS NULL OR char_length("announcement") BETWEEN 3 AND 200);

-- Novedades vigentes de complejos publicados (solo datos públicos).
CREATE FUNCTION app_public_announcements(p_limit integer)
  RETURNS TABLE (slug text, name text, city text, announcement text, announcement_until date, logo_asset_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT t.slug, t.name, t.city, t.announcement, t.announcement_until,
         (SELECT a.id FROM tenant_assets a WHERE a.tenant_id = t.id AND a.kind = 'LOGO' ORDER BY a.created_at DESC LIMIT 1)
    FROM tenants t
   WHERE t.status = 'ACTIVE' AND t.public_listed AND t.announcement IS NOT NULL
     AND (t.announcement_until IS NULL OR t.announcement_until >= (now() AT TIME ZONE t.timezone)::date)
     AND EXISTS (SELECT 1 FROM courts c WHERE c.tenant_id = t.id AND c.is_active)
   ORDER BY t.updated_at DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50)
$$;
REVOKE EXECUTE ON FUNCTION app_public_announcements(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_public_announcements(integer) TO app_runtime;
