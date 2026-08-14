-- owner joins admin as a dashboard role -- admin-equivalent-or-greater
-- everywhere requireAdmin is checked (see backend/src/lib/roles.ts), never
-- less. No schema change needed: role has been plain TEXT since
-- 0040_users_role.sql, enforced by USER_ROLES in backend/src/routes/users.ts.
-- This migration exists purely to mark the role-set change in the
-- migration history, matching 0048_crew_role_foreman_owner.sql's
-- reasoning on the crew_members side.
SELECT 1;
