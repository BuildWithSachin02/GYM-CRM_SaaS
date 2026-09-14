-- CreateIndex
CREATE INDEX "Member_organizationId_deletedAt_createdAt_idx" ON "Member"("organizationId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "Membership_organizationId_status_endDate_idx" ON "Membership"("organizationId", "status", "endDate");

-- CreateIndex
CREATE INDEX "Payment_organizationId_status_paymentDate_idx" ON "Payment"("organizationId", "status", "paymentDate");

-- CreateIndex
CREATE INDEX "CheckIn_organizationId_dayKey_idx" ON "CheckIn"("organizationId", "dayKey");

-- CreateIndex
CREATE INDEX "Lead_organizationId_deletedAt_stage_followUpDate_idx" ON "Lead"("organizationId", "deletedAt", "stage", "followUpDate");

-- CreateIndex
CREATE INDEX "Appointment_organizationId_status_startsAt_idx" ON "Appointment"("organizationId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "Task_organizationId_status_dueDate_idx" ON "Task"("organizationId", "status", "dueDate");