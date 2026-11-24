-- Fase 3.1 · Bloque 5: listado público de complejos en la portada.
-- Aditiva: una columna con valor por defecto y una función de solo lectura.

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "public_listed" BOOLEAN NOT NULL DEFAULT true;

-- Directorio público. SECURITY DEFINER porque se consulta sin contexto de
-- complejo (la portada); devuelve SOLO datos que ya son públicos en la página
-- de cada complejo (nombre, slug, dirección, deportes, cantidad de canchas y el
-- id del logo). Solo complejos ACTIVOS, que no se excluyeron y con al menos
-- una cancha activa. Nada de clientes, reservas, contactos privados ni planes.
CREATE FUNCTION app_public_directory(p_limit integer)
  RETURNS TABLE (slug text, name text, address text, sports text[], court_count integer, logo_asset_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT t.slug, t.name, t.address,
         ARRAY(SELECT DISTINCT c.sport::text FROM courts c WHERE c.tenant_id = t.id AND c.is_active ORDER BY 1),
         (SELECT count(*)::integer FROM courts c WHERE c.tenant_id = t.id AND c.is_active),
         (SELECT a.id FROM tenant_assets a WHERE a.tenant_id = t.id AND a.kind = 'LOGO' ORDER BY a.created_at DESC LIMIT 1)
    FROM tenants t
   WHERE t.status = 'ACTIVE'
     AND t.public_listed
     AND EXISTS (SELECT 1 FROM courts c WHERE c.tenant_id = t.id AND c.is_active)
   ORDER BY t.name
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
$$;

REVOKE EXECUTE ON FUNCTION app_public_directory(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_public_directory(integer) TO app_runtime;
