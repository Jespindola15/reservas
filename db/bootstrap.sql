-- =============================================================================
-- Bootstrap del servidor PostgreSQL (ejecutar UNA vez, como superusuario).
-- Crea los roles. Las contraseñas se pasan como variables de psql para no
-- quedar escritas en el repositorio:
--
--   psql -v owner_pw="'...'" -v app_pw="'...'" -f db/bootstrap.sql
--
-- Luego crear las bases con dueño reservas_owner (ver README).
-- =============================================================================

-- Rol de grupo con los permisos de runtime (los GRANT los hacen las migraciones).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

-- Dueño del esquema: corre migraciones y seed. NUNCA lo usa la app en runtime.
SELECT 'CREATE ROLE reservas_owner LOGIN CREATEDB PASSWORD ' || :'owner_pw'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reservas_owner') \gexec

-- Usuario de la app: sin BYPASSRLS, no es dueño de tablas => RLS siempre aplica.
SELECT 'CREATE ROLE reservas_app LOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ' || :'app_pw'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reservas_app') \gexec

GRANT app_runtime TO reservas_app;

-- Zona horaria de sesión UTC para los roles de TURNUP (ver src/lib/db/safety.ts).
ALTER ROLE reservas_app SET timezone TO 'UTC';
ALTER ROLE reservas_owner SET timezone TO 'UTC';
