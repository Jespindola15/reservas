-- =============================================================================
-- TURNUP — Verificación de la base (solo lectura; no modifica nada).
-- Uso: psql "$MIGRATION_DATABASE_URL" -f db/verify.sql
-- Cada fila debe decir ok = t. Si alguna dice f, NO habilitar el sitio.
-- =============================================================================
WITH checks(check_name, ok, detail) AS (
  SELECT 'extensión btree_gist', EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist'), ''
  UNION ALL
  SELECT 'migraciones aplicadas (sin fallidas)',
         (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) >= 5
         AND NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL),
         (SELECT count(*)::text || ' aplicadas' FROM _prisma_migrations WHERE finished_at IS NOT NULL)
  UNION ALL
  SELECT 'restricción antisolapamiento (EXCLUDE) en court_allocations',
         EXISTS (SELECT 1 FROM pg_constraint WHERE contype = 'x' AND conrelid = 'public.court_allocations'::regclass), ''
  UNION ALL
  SELECT 'RLS activo en tablas de negocio',
         NOT EXISTS (
           SELECT 1 FROM unnest(ARRAY['tenants','memberships','courts','bookings','court_allocations','customers',
                                      'audit_logs','court_schedule_rules','court_price_rules','schedule_exceptions',
                                      'court_images','availability_blocks']) t
            WHERE NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relname = t AND c.relnamespace = 'public'::regnamespace AND c.relrowsecurity)),
         (SELECT count(*)::text || ' tablas con RLS' FROM pg_class WHERE relrowsecurity AND relnamespace = 'public'::regnamespace)
  UNION ALL
  SELECT 'triggers de integridad instalados',
         (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace)) >= 3,
         (SELECT count(*)::text || ' triggers' FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace))
  UNION ALL
  SELECT 'funciones app_* instaladas',
         EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'app_expire_pending_bookings')
         AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'app_current_tenant_id'),
         (SELECT count(*)::text || ' funciones' FROM pg_proc WHERE proname LIKE 'app\_%' AND pronamespace = 'public'::regnamespace)
  UNION ALL
  SELECT 'rol reservas_app: sin superusuario ni BYPASSRLS',
         EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reservas_app' AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb), ''
  UNION ALL
  SELECT 'rol reservas_app: no hereda neon_superuser',
         NOT EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname IN ('neon_superuser') AND pg_has_role('reservas_app', r.oid, 'MEMBER')), ''
  UNION ALL
  SELECT 'rol reservas_app: no es dueño de tablas',
         NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
                      WHERE r.rolname = 'reservas_app' AND c.relnamespace = 'public'::regnamespace), ''
  UNION ALL
  SELECT 'zona horaria por defecto de la base = UTC',
         EXISTS (SELECT 1 FROM pg_db_role_setting s JOIN pg_database d ON d.oid = s.setdatabase
                  WHERE d.datname = current_database() AND s.setrole = 0 AND 'TimeZone=UTC' = ANY (s.setconfig))
         OR EXISTS (SELECT 1 FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole
                  WHERE r.rolname = 'reservas_app' AND 'TimeZone=UTC' = ANY (s.setconfig)),
         ''
  UNION ALL
  SELECT 'rol reservas_app: miembro de app_runtime', pg_has_role('reservas_app', 'app_runtime', 'MEMBER'), ''
  UNION ALL
  SELECT 'reservas_app no puede escribir court_allocations ni modificar auditoría',
         NOT has_table_privilege('reservas_app', 'public.court_allocations', 'INSERT')
         AND NOT has_table_privilege('reservas_app', 'public.audit_logs', 'UPDATE')
         AND NOT has_table_privilege('reservas_app', 'public.audit_logs', 'DELETE'), ''
)
SELECT check_name, ok, detail FROM checks;
