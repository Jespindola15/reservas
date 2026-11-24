-- La guardia de membresías aplica al ROL DE LA APLICACIÓN (miembros de app_runtime).
-- El rol dueño (migraciones, seed, mantenimiento con credenciales de administrador)
-- queda fuera, igual que con RLS.
CREATE OR REPLACE FUNCTION app_guard_membership() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE actor_role "MembershipRole";
BEGIN
  IF NOT pg_has_role(current_user, 'app_runtime', 'MEMBER') OR app_is_platform_admin() THEN
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
