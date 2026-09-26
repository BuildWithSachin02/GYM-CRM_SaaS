-- DropEnum
-- NOTE: PostgreSQL cannot ALTER the type of an ENUM used by table columns with
-- a plain diff. Instead we RENAME the existing enum TYPE (cheap, non-locking,
-- fully supported) so the schema value "BranchStatus" matches the datamodel.
ALTER TYPE "LocationStatus" RENAME TO "BranchStatus";

-- AlterTable
-- Promote GymLocation -> Branch. All names (table, PK, FK, unique index, plain
-- indexes) are renamed to match what Prisma expects from the datamodel, so the
-- shadow-database diff comes out empty.
ALTER TABLE "GymLocation" RENAME TO "Branch";
ALTER TABLE "Branch" RENAME CONSTRAINT "GymLocation_pkey" TO "Branch_pkey";
ALTER TABLE "Branch" RENAME CONSTRAINT "GymLocation_organizationId_fkey" TO "Branch_organizationId_fkey";
ALTER INDEX "GymLocation_organizationId_name_key" RENAME TO "Branch_organizationId_name_key";
ALTER INDEX "GymLocation_organizationId_idx" RENAME TO "Branch_organizationId_idx";
ALTER INDEX "GymLocation_organizationId_status_idx" RENAME TO "Branch_organizationId_status_idx";

-- New columns; drop the never-read per-branch timezone (Branch inherits the
-- ORGANIZATION timezone — see the datamodel comment).
ALTER TABLE "Branch" ADD COLUMN "branchCode" TEXT;
ALTER TABLE "Branch" ADD COLUMN "phone" TEXT;
ALTER TABLE "Branch" ADD COLUMN "email" TEXT;
ALTER TABLE "Branch" ADD COLUMN "country" TEXT;
ALTER TABLE "Branch" DROP COLUMN "timezone";

-- Backfill branchCode deterministically: BR-0001, BR-0002, ... ordered by
-- (organizationId, createdAt, id). Existing name "King's Gym — Main" is kept;
-- no branch is ever renamed by this migration.
UPDATE "Branch" b
SET "branchCode" = 'BR-' || LPAD(seq::text, 4, '0')
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY "createdAt", "id") AS seq
  FROM "Branch"
) r
WHERE r."id" = b."id";

ALTER TABLE "Branch" ALTER COLUMN "branchCode" SET NOT NULL;
CREATE UNIQUE INDEX "Branch_organizationId_branchCode_key" ON "Branch"("organizationId", "branchCode");
CREATE INDEX "Branch_organizationId_status_name_idx" ON "Branch"("organizationId", "status", "name");

-- Every organization must have at least one branch before any NOT NULL
-- backfill can rely on it. Deterministic default: "Main Branch" / BR-0001,
-- created ONLY for organizations that currently have zero branches.
INSERT INTO "Branch" ("id", "organizationId", "branchCode", "name", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid(), o."id", 'BR-0001', 'Main Branch', 'ACTIVE', NOW(), NOW()
FROM "Organization" o
WHERE NOT EXISTS (SELECT 1 FROM "Branch" b WHERE b."organizationId" = o."id");

-- Rename the FK *columns* across the historical tables. PostgreSQL keeps each
-- FK constraint's column reference in sync with the rename automatically; we
-- then rename the constraint objects themselves to match the datamodel.
ALTER TABLE "Member" RENAME COLUMN "primaryLocationId" TO "homeBranchId";
ALTER TABLE "CheckIn" RENAME COLUMN "locationId" TO "branchId";
ALTER TABLE "QRSession" RENAME COLUMN "locationId" TO "branchId";
ALTER TABLE "Lead" RENAME COLUMN "locationId" TO "branchId";
ALTER TABLE "Appointment" RENAME COLUMN "locationId" TO "branchId";

ALTER TABLE "Member" RENAME CONSTRAINT "Member_primaryLocationId_fkey" TO "Member_homeBranchId_fkey";
ALTER TABLE "CheckIn" RENAME CONSTRAINT "CheckIn_locationId_fkey" TO "CheckIn_branchId_fkey";
ALTER TABLE "QRSession" RENAME CONSTRAINT "QRSession_locationId_fkey" TO "QRSession_branchId_fkey";
ALTER TABLE "Lead" RENAME CONSTRAINT "Lead_locationId_fkey" TO "Lead_branchId_fkey";
ALTER TABLE "Appointment" RENAME CONSTRAINT "Appointment_locationId_fkey" TO "Appointment_branchId_fkey";

ALTER INDEX "Member_organizationId_primaryLocationId_idx" RENAME TO "Member_organizationId_homeBranchId_idx";
DROP INDEX "CheckIn_organizationId_locationId_checkedInAt_idx";

-- ----- Membership.branchId (NOT NULL + Restrict) ---------------------------
ALTER TABLE "Membership" ADD COLUMN "branchId" TEXT;

-- Member home branch first (most accurate signal we have).
UPDATE "Membership" ms
SET "branchId" = mb."homeBranchId"
FROM "Member" mb
WHERE ms."memberId" = mb."id" AND mb."homeBranchId" IS NOT NULL;

-- Orphan/None: the organization's earliest-created branch (deterministic).
UPDATE "Membership" ms
SET "branchId" = (
  SELECT b."id" FROM "Branch" b
  WHERE b."organizationId" = ms."organizationId"
  ORDER BY b."createdAt", b."id" LIMIT 1
)
WHERE ms."branchId" IS NULL;

ALTER TABLE "Membership" ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Membership_organizationId_branchId_status_idx" ON "Membership"("organizationId", "branchId", "status");
CREATE INDEX "Membership_organizationId_branchId_status_endDate_idx" ON "Membership"("organizationId", "branchId", "status", "endDate");

-- ----- Payment.branchId (NOT NULL + Restrict, denormalized from membership --)
ALTER TABLE "Payment" ADD COLUMN "branchId" TEXT;

-- A payment is a financial fact: it inherits the branch it was actually
-- collected at. Best signal = the linked membership's branch (now set above).
UPDATE "Payment" p
SET "branchId" = m."branchId"
FROM "Membership" m
WHERE p."membershipId" = m."id" AND p."branchId" IS NULL;

-- Payment with no membership link: member's home branch, else org default.
UPDATE "Payment" p
SET "branchId" = mb."homeBranchId"
FROM "Member" mb
WHERE p."memberId" = mb."id" AND p."branchId" IS NULL AND mb."homeBranchId" IS NOT NULL;

UPDATE "Payment" p
SET "branchId" = (
  SELECT b."id" FROM "Branch" b
  WHERE b."organizationId" = p."organizationId"
  ORDER BY b."createdAt", b."id" LIMIT 1
)
WHERE p."branchId" IS NULL;

ALTER TABLE "Payment" ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Payment_organizationId_branchId_paymentDate_idx" ON "Payment"("organizationId", "branchId", "paymentDate");

-- ----- CheckIn.branchId (NOT NULL + Restrict) ------------------------------
-- Existing rows that predate the (optional) location column are assigned the
-- org's earliest branch. The FK then flips from SET NULL to RESTRICT: a
-- check-in is historical fact and must never lose its branch.
UPDATE "CheckIn" c
SET "branchId" = (
  SELECT b."id" FROM "Branch" b
  WHERE b."organizationId" = c."organizationId"
  ORDER BY b."createdAt", b."id" LIMIT 1
)
WHERE c."branchId" IS NULL;

ALTER TABLE "CheckIn" ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "CheckIn" DROP CONSTRAINT "CheckIn_branchId_fkey";
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "CheckIn_organizationId_branchId_dayKey_idx" ON "CheckIn"("organizationId", "branchId", "dayKey");

-- ----- AttendanceRequest.branchId (NOT NULL + Restrict) --------------------
ALTER TABLE "AttendanceRequest" ADD COLUMN "branchId" TEXT;

-- Derived from the QR session the member actually scanned (server-side truth).
UPDATE "AttendanceRequest" ar
SET "branchId" = qs."branchId"
FROM "QRSession" qs
WHERE ar."qrSessionId" = qs."id" AND ar."branchId" IS NULL;

-- Fallback (request created without a QR link): member home, else org default.
UPDATE "AttendanceRequest" ar
SET "branchId" = mb."homeBranchId"
FROM "Member" mb
WHERE ar."memberId" = mb."id" AND ar."branchId" IS NULL AND mb."homeBranchId" IS NOT NULL;

UPDATE "AttendanceRequest" ar
SET "branchId" = (
  SELECT b."id" FROM "Branch" b
  WHERE b."organizationId" = ar."organizationId"
  ORDER BY b."createdAt", b."id" LIMIT 1
)
WHERE ar."branchId" IS NULL;

ALTER TABLE "AttendanceRequest" ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "AttendanceRequest" ADD CONSTRAINT "AttendanceRequest_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "AttendanceRequest_organizationId_branchId_status_idx" ON "AttendanceRequest"("organizationId", "branchId", "status");

-- ----- Task.branchId (nullable + SetNull; NULL = organization-wide) --------
ALTER TABLE "Task" ADD COLUMN "branchId" TEXT;

-- Follow-ups about a specific member/lead inherit that record's branch.
-- Unattached tasks stay organization-wide (NULL), visible in every branch.
UPDATE "Task" t
SET "branchId" = mb."homeBranchId"
FROM "Member" mb
WHERE t."memberId" = mb."id" AND t."branchId" IS NULL AND mb."homeBranchId" IS NOT NULL;

UPDATE "Task" t
SET "branchId" = l."branchId"
FROM "Lead" l
WHERE t."leadId" = l."id" AND t."branchId" IS NULL AND l."branchId" IS NOT NULL;

ALTER TABLE "Task" ADD CONSTRAINT "Task_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Task_organizationId_branchId_status_dueDate_idx" ON "Task"("organizationId", "branchId", "status", "dueDate");

-- ----- New branch scoping indexes on existing optional columns -------------
CREATE INDEX "QRSession_organizationId_branchId_expiresAt_idx" ON "QRSession"("organizationId", "branchId", "expiresAt");
CREATE INDEX "Lead_organizationId_branchId_stage_idx" ON "Lead"("organizationId", "branchId", "stage");
CREATE INDEX "Lead_organizationId_branchId_stage_followUpDate_idx" ON "Lead"("organizationId", "branchId", "stage", "followUpDate");
CREATE INDEX "Appointment_organizationId_branchId_startsAt_idx" ON "Appointment"("organizationId", "branchId", "startsAt");

-- ----- UserBranch (per-user branch access; OWNER needs no rows) ------------
CREATE TABLE "UserBranch" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UserBranch_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "UserBranch" ADD CONSTRAINT "UserBranch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserBranch" ADD CONSTRAINT "UserBranch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserBranch" ADD CONSTRAINT "UserBranch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "UserBranch_organizationId_userId_branchId_key" ON "UserBranch"("organizationId", "userId", "branchId");
CREATE INDEX "UserBranch_organizationId_idx" ON "UserBranch"("organizationId");
CREATE INDEX "UserBranch_organizationId_userId_idx" ON "UserBranch"("organizationId", "userId");
CREATE INDEX "UserBranch_organizationId_branchId_idx" ON "UserBranch"("organizationId", "branchId");

-- Backfill: every ACTIVE non-OWNER user gets every ACTIVE branch, with a
-- single deterministic PRIMARY branch (the organization's earliest-created
-- active branch by createdAt, id). OWNER users hold org-wide access by role
-- and deliberately receive no rows.
WITH ranked AS (
  SELECT
    u."id" AS "userId",
    u."organizationId",
    b."id" AS "branchId",
    ROW_NUMBER() OVER (PARTITION BY u."id" ORDER BY b."createdAt", b."id") AS rn
  FROM "User" u
  JOIN "Branch" b
    ON b."organizationId" = u."organizationId"
   AND b."status" = 'ACTIVE'
  WHERE u."role" <> 'OWNER'
    AND u."status" = 'ACTIVE'
)
INSERT INTO "UserBranch" ("id", "organizationId", "userId", "branchId", "isPrimary", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "organizationId", "userId", "branchId", (rn = 1), NOW(), NOW()
FROM ranked;