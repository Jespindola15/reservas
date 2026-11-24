-- Ubicación de complejos: provincia y coordenadas (aditiva). Recrea app_public_catalog con los campos nuevos.
ALTER TABLE "tenants" ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "province" TEXT;

ALTER TABLE "tenants"
  ADD CONSTRAINT "tenants_province_len" CHECK ("province" IS NULL OR char_length("province") BETWEEN 2 AND 60),
  ADD CONSTRAINT "tenants_coordinates" CHECK (
    ("latitude" IS NULL AND "longitude" IS NULL)
    OR ("latitude" IS NOT NULL AND "longitude" IS NOT NULL
        AND "latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180)
  );

-- El catálogo devuelve además provincia y coordenadas (datos ya públicos en la ficha).
-- La versión publicada antes de esta migración no usa esta función, así que recrearla es compatible.
DROP FUNCTION IF EXISTS app_public_catalog(integer);
CREATE FUNCTION app_public_catalog(p_limit integer)
  RETURNS TABLE (
    id uuid, slug text, name text, city text, address text, sports text[], court_count integer,
    logo_asset_id uuid, cover_asset_id uuid, min_hour_price integer, currency text, services text[],
    rating_avg numeric, rating_count integer, has_covered boolean, deposit_type text,
    province text, latitude double precision, longitude double precision
  )
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT t.id, t.slug, t.name, t.city, t.address,
         ARRAY(SELECT DISTINCT c.sport::text FROM courts c WHERE c.tenant_id = t.id AND c.is_active ORDER BY 1),
         (SELECT count(*)::integer FROM courts c WHERE c.tenant_id = t.id AND c.is_active),
         (SELECT a.id FROM tenant_assets a WHERE a.tenant_id = t.id AND a.kind = 'LOGO' ORDER BY a.created_at DESC LIMIT 1),
         (SELECT a.id FROM tenant_assets a WHERE a.tenant_id = t.id AND a.kind = 'COVER' ORDER BY a.created_at DESC LIMIT 1),
         -- Precio por hora más bajo, redondeado a $100 (10000 centavos) para mostrar "desde $X/h".
         (SELECT (round(min(r.amount * 60.0 / r.duration_minutes) / 10000) * 10000)::integer FROM court_price_rules r JOIN courts c ON c.tenant_id = r.tenant_id AND c.id = r.court_id
           WHERE r.tenant_id = t.id AND c.is_active AND r.special_date IS NULL),
         t.currency::text, t.services,
         (SELECT round(avg(v.rating)::numeric, 1) FROM reviews v WHERE v.tenant_id = t.id AND v.status = 'PUBLISHED'),
         (SELECT count(*)::integer FROM reviews v WHERE v.tenant_id = t.id AND v.status = 'PUBLISHED'),
         EXISTS (SELECT 1 FROM courts c WHERE c.tenant_id = t.id AND c.is_active AND c.covered),
         t.deposit_type, t.province, t.latitude, t.longitude
    FROM tenants t
   WHERE t.status = 'ACTIVE' AND t.public_listed
     AND EXISTS (SELECT 1 FROM courts c WHERE c.tenant_id = t.id AND c.is_active)
   ORDER BY t.name
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)
$$;
REVOKE EXECUTE ON FUNCTION app_public_catalog(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_public_catalog(integer) TO app_runtime;
