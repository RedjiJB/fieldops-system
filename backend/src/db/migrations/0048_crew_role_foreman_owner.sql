-- crew_lead never gated anything anywhere in this codebase -- pure
-- rename/redefinition to match how the crew actually talks about the job
-- (foreman/site supervisor), not a new tier alongside it. owner is
-- genuinely new: admin-equivalent-or-greater everywhere requireAdmin is
-- checked (see backend/src/lib/roles.ts), and joins management on the
-- confirmation-approval gate (see confirmations.ts's resolveReviewer).
-- role stays plain TEXT (see 0001_crew_members.sql's comment) -- enforced
-- by CREW_ROLES in backend/src/routes/crewMembers.ts, not a DB constraint.
UPDATE crew_members SET role = 'foreman' WHERE role = 'crew_lead';
