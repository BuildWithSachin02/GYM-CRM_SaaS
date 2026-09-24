import "server-only"

import type { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"

type AuditArgs = {
  organizationId: string
  actorUserId?: string | null
  action: string
  entityType: string
  entityId?: string | null
  before?: Prisma.InputJsonValue | null
  after?: Prisma.InputJsonValue | null
  ip?: string | null
}

/** Append-only audit writer. Never update/delete rows created via this. */
export async function writeAudit(args: AuditArgs) {
  return prisma.auditLog.create({
    data: {
      organizationId: args.organizationId,
      actorUserId: args.actorUserId ?? null,
      action: args.action,
      entityType: args.entityType,
      entityId: args.entityId ?? null,
      before: args.before ?? undefined,
      after: args.after ?? undefined,
      ip: args.ip ?? null,
    },
  })
}

export const AUDIT_ACTIONS = {
  MEMBER_CREATED: "member.created",
  MEMBER_UPDATED: "member.updated",
  MEMBER_ARCHIVED: "member.archived",
  PLAN_CREATED: "plan.created",
  PLAN_UPDATED: "plan.updated",
  MEMBERSHIP_CREATED: "membership.created",
  MEMBERSHIP_RENEWED: "membership.renewed",
  MEMBERSHIP_CANCELLED: "membership.cancelled",
  PAYMENT_RECORDED: "payment.recorded",
  PAYMENT_VOIDED: "payment.voided",
  LEAD_CREATED: "lead.created",
  LEAD_UPDATED: "lead.updated",
  LEAD_STAGE_CHANGED: "lead.stage_changed",
  LEAD_ACTIVITY_CREATED: "lead.activity_created",
  LEAD_CONVERTED: "lead.converted",
  LEAD_ASSIGNED: "lead.assigned",
  APPOINTMENT_CREATED: "appointment.created",
  APPOINTMENT_UPDATED: "appointment.updated",
  TASK_CREATED: "task.created",
  TASK_UPDATED: "task.updated",
  TRAINER_CREATED: "trainer.created",
  TRAINER_UPDATED: "trainer.updated",
  STAFF_CREATED: "staff.created",
  STAFF_UPDATED: "staff.updated",
  CHECKIN_MANUAL: "attendance.manual",
  CHECKIN_QR: "attendance.qr",
  QR_SESSION_CREATED: "qrsession.created",
  QR_SESSION_REVOKED: "qrsession.revoked",
  ATTENDANCE_REQUEST_CREATED: "attendance.request_created",
  ATTENDANCE_REQUEST_APPROVED: "attendance.request_approved",
  ATTENDANCE_REQUEST_REJECTED: "attendance.request_rejected",
  DEVICE_REMEMBERED: "qr.device_remembered",
  DEVICE_REVOKED: "qr.device_revoked",
  ORG_UPDATED: "organization.updated",
  DATA_EXPORTED: "data.exported",
  DATA_RESET: "data.reset",
} as const