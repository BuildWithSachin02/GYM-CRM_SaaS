-- Member Code: org-scoped, human-facing identifier (display only).
-- The UUID `id` remains the canonical identity.

-- 1. Add the column nullable so existing rows can be backfilled.
ALTER TABLE "Member" ADD COLUMN "memberCode" TEXT;

-- 2. Deterministic backfill: per-organization sequence ordered by createdAt
--    then id (stable tie-break). Codes start at 1 per org and are permanent.
WITH ordered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "organizationId"
      ORDER BY "createdAt" ASC, id ASC
    ) AS seq
  FROM "Member"
)
UPDATE "Member" m
SET "memberCode" = 'MEM-' || LPAD(ordered.seq::text, 4, '0')
FROM ordered
WHERE m.id = ordered.id;

-- 3. Presence + org-scoped uniqueness.
ALTER TABLE "Member" ALTER COLUMN "memberCode" SET NOT NULL;
CREATE UNIQUE INDEX "Member_organizationId_memberCode_key"
  ON "Member"("organizationId", "memberCode");

-- 4. Phone is no longer org-unique: different members may share a number
--    (family members). Duplicate detection moved to the application layer.
DROP INDEX IF EXISTS "Member_organizationId_phone_key";