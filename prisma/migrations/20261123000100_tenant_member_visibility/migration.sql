-- Un usuario puede LEER los complejos donde tiene membresía (para listar
-- "mis complejos" sin fijar un contexto de tenant). Escritura sin cambios.
-- La política de memberships no referencia tenants, así que no hay recursión.
DROP POLICY tenant_read ON "tenants";
CREATE POLICY tenant_read ON "tenants" FOR SELECT USING (
  id = app_current_tenant_id()
  OR app_is_platform_admin()
  OR EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.tenant_id = tenants.id AND m.user_id = app_current_user_id()
  )
);
