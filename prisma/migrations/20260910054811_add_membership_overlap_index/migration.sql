-- CreateIndex
CREATE INDEX "Membership_organizationId_memberId_status_startDate_endDate_idx" ON "Membership"("organizationId", "memberId", "status", "startDate", "endDate");
