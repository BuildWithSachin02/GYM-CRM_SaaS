-- DATABASE_DESIGN D-08 removal: the partial unique index that allowed only
-- one ACTIVE/PAUSED membership per (organizationId, memberId, planId) is
-- removed. A member must be able to hold multiple membership periods for the
-- same plan over time. The "one active membership per period" business rule
-- is now enforced in the application layer (src/lib/memberships.ts and the
-- membership server actions) instead of the database.
--
-- Existing memberships, payments, attendance, leads, trainers, appointments,
-- tasks, notifications and audit logs are unaffected.

DROP INDEX IF EXISTS "Membership_one_active_per_plan_idx";