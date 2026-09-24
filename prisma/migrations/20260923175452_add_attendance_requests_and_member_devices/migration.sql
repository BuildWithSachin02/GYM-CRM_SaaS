-- CreateEnum
CREATE TYPE "AttendanceRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'ATTENDANCE_REQUEST';

-- CreateTable
CREATE TABLE "MemberDevice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "qrSessionId" TEXT,
    "source" "AttendanceSource" NOT NULL DEFAULT 'QR_SESSION',
    "status" "AttendanceRequestStatus" NOT NULL DEFAULT 'PENDING',
    "dayKey" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectionReason" TEXT,
    "checkInId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MemberDevice_tokenHash_key" ON "MemberDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "MemberDevice_organizationId_idx" ON "MemberDevice"("organizationId");

-- CreateIndex
CREATE INDEX "MemberDevice_organizationId_memberId_idx" ON "MemberDevice"("organizationId", "memberId");

-- CreateIndex
CREATE INDEX "MemberDevice_organizationId_revokedAt_idx" ON "MemberDevice"("organizationId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRequest_checkInId_key" ON "AttendanceRequest"("checkInId");

-- CreateIndex
CREATE INDEX "AttendanceRequest_organizationId_idx" ON "AttendanceRequest"("organizationId");

-- CreateIndex
CREATE INDEX "AttendanceRequest_organizationId_status_idx" ON "AttendanceRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "AttendanceRequest_organizationId_memberId_idx" ON "AttendanceRequest"("organizationId", "memberId");

-- CreateIndex
CREATE INDEX "AttendanceRequest_organizationId_requestedAt_idx" ON "AttendanceRequest"("organizationId", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRequest_organizationId_memberId_dayKey_key" ON "AttendanceRequest"("organizationId", "memberId", "dayKey");

-- AddForeignKey
ALTER TABLE "MemberDevice" ADD CONSTRAINT "MemberDevice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberDevice" ADD CONSTRAINT "MemberDevice_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRequest" ADD CONSTRAINT "AttendanceRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRequest" ADD CONSTRAINT "AttendanceRequest_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRequest" ADD CONSTRAINT "AttendanceRequest_qrSessionId_fkey" FOREIGN KEY ("qrSessionId") REFERENCES "QRSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRequest" ADD CONSTRAINT "AttendanceRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRequest" ADD CONSTRAINT "AttendanceRequest_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRequest" ADD CONSTRAINT "AttendanceRequest_checkInId_fkey" FOREIGN KEY ("checkInId") REFERENCES "CheckIn"("id") ON DELETE SET NULL ON UPDATE CASCADE;
