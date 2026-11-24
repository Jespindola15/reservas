-- =============================================================================
-- TURNUP — Preparación de Neon (ejecutar UNA vez por rama, en el SQL Editor de Neon
-- conectado a la base "neondb" con el rol administrador del proyecto, p. ej. neondb_owner).
--
-- Por qué un archivo distinto de db/bootstrap.sql: en Neon no hay superusuario.
-- El rol administrador pertenece a neon_superuser (CREATEROLE, CREATEDB, BYPASSRLS).
-- Los roles creados desde la CONSOLA o la API de Neon también reciben neon_superuser
-- y por lo tanto BYPASSRLS: por eso los roles de TURNUP se crean SOLO con SQL, donde
-- nacen sin privilegios especiales.
--
-- Resultado:
--   app_runtime     NOLOGIN, NOBYPASSRLS  -> grupo con los permisos de la app (los GRANT los hacen las migraciones)
--   reservas_owner  LOGIN,   NOBYPASSRLS  -> dueño del esquema: migraciones. Nunca lo usa la app.
--   reservas_app    LOGIN,   NOBYPASSRLS  -> la app (Netlify). No es dueño de nada => RLS siempre aplica.
--   base "turnup"   dueña: reservas_owner  (no se toca la base neondb que trae Neon)
--
-- ANTES DE EJECUTAR: reemplazá las dos contraseñas por valores largos y aleatorios
-- (por ejemplo, el resultado de `openssl rand -base64 30` sin "/" ni "+", o el generador
-- de tu gestor de contraseñas, 32+ caracteres). NO las guardes en este archivo ni en git.
-- Neon exige contraseñas robustas para roles creados por SQL.
-- =============================================================================

-- 1) Roles ---------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reservas_owner') THEN
    CREATE ROLE reservas_owner LOGIN NOBYPASSRLS NOCREATEROLE PASSWORD 'REEMPLAZAR_CONTRASENA_OWNER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reservas_app') THEN
    CREATE ROLE reservas_app LOGIN NOBYPASSRLS NOCREATEROLE NOCREATEDB PASSWORD 'REEMPLAZAR_CONTRASENA_APP';
  END IF;
END $$;

GRANT app_runtime TO reservas_app;

-- 2) Base de datos propia --------------------------------------------------------
-- PostgreSQL 16+: para crear una base cuyo dueño es otro rol, el administrador debe
-- poder "actuar como" ese rol. Se le da SET (sin heredar sus permisos).
GRANT reservas_owner TO CURRENT_USER WITH SET TRUE, INHERIT FALSE;

-- (CREATE DATABASE no puede ir dentro de un bloque DO; si ya existe, este paso da
--  error "already exists" y se puede ignorar.)
CREATE DATABASE turnup OWNER reservas_owner;

-- 3) Acceso a la base: solo los roles de TURNUP pueden conectarse ----------------
SET ROLE reservas_owner;
REVOKE ALL ON DATABASE turnup FROM PUBLIC;
GRANT CONNECT ON DATABASE turnup TO reservas_app;
-- Zona horaria de sesión UTC (OBLIGATORIO): el driver envía fechas sin zona y PostgreSQL las
-- interpreta con esta configuración. La app además la fija en cada transacción y se niega a
-- operar si detecta otra (ver src/lib/db/safety.ts).
ALTER DATABASE turnup SET timezone TO 'UTC';
RESET ROLE;
ALTER ROLE reservas_app SET timezone TO 'UTC';
ALTER ROLE reservas_owner SET timezone TO 'UTC';

-- 4) Comprobación (debe mostrar f en rolbypassrls y rolsuper para los tres) -------
SELECT rolname, rolcanlogin, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
  FROM pg_roles
 WHERE rolname IN ('app_runtime', 'reservas_owner', 'reservas_app')
 ORDER BY rolname;
