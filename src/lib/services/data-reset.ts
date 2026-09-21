import "server-only"

import type { Prisma } from "@prisma/client"

import {
  buildResetPlan,
  type DataCategoryKey,
  type DataDateRange,
  type ResetOperation,
} from "@/lib/data-catalog"
import { prisma } from "@/lib/prisma"
import { AUDIT_ACTIONS } from "@/lib/audit"

/**
 * Tenant-safe reset service. Every delete is scoped to the session
 * organization and the dependency-aware plan from data-catalog, executed as a
 * single transaction so a partial reset can never happen.
 */

export type ResetPreviewCategory = {
  category: DataCategoryKey
  label: string
  role: ResetOperation["role"]
  dependencyOf: ResetOperation["dependencyOf"]
  count: number
}

export type ResetPreview = {
  categories: ResetPreviewCategory[]
  total: number
}

export type ResetExecuteArgs = {
  organizationId: string
  categoryKeys: DataCategoryKey[]
  range: DataDateRange
  timeZone: string
  /** Who initiated the reset (recorded in the append-only audit row). */
  actorUserId?: string | null
}

export type ResetExecuteResult = {
  deleted: number
  categories: ResetPreviewCategory[]
}

function countByOperation(
  tx: Prisma.TransactionClient,
  op: ResetOperation
): Promise<number> {
  const where = op.where
  switch (op.modelName) {
    case "member":
      return tx.member.count({ where: where as Prisma.MemberWhereInput })
    case "membership":
      return tx.membership.count({ where: where as Prisma.MembershipWhereInput })
    case "membershipPlan":
      return tx.membershipPlan.count({ where: where as Prisma.MembershipPlanWhereInput })
    case "payment":
      return tx.payment.count({ where: where as Prisma.PaymentWhereInput })
    case "checkIn":
      return tx.checkIn.count({ where: where as Prisma.CheckInWhereInput })
    case "lead":
      return tx.lead.count({ where: where as Prisma.LeadWhereInput })
    case "appointment":
      return tx.appointment.count({ where: where as Prisma.AppointmentWhereInput })
    case "task":
      return tx.task.count({ where: where as Prisma.TaskWhereInput })
    case "qrSession":
      return tx.qRSession.count({ where: where as Prisma.QRSessionWhereInput })
    case "leadActivity":
      return tx.leadActivity.count({ where: where as Prisma.LeadActivityWhereInput })
    // Trainers are export-only (never reset-table): the catalog never emits a
    // trainer operation, so this branch is defensive and unreachable.
    case "trainer":
      throw new Error("Trainers are not part of the data reset flow.")
  }
}

function deleteByOperation(
  tx: Prisma.TransactionClient,
  op: ResetOperation
): Promise<{ count: number }> {
  const where = op.where
  switch (op.modelName) {
    case "member":
      return tx.member.deleteMany({ where: where as Prisma.MemberWhereInput })
    case "membership":
      return tx.membership.deleteMany({ where: where as Prisma.MembershipWhereInput })
    case "membershipPlan":
      return tx.membershipPlan.deleteMany({ where: where as Prisma.MembershipPlanWhereInput })
    case "payment":
      return tx.payment.deleteMany({ where: where as Prisma.PaymentWhereInput })
    case "checkIn":
      return tx.checkIn.deleteMany({ where: where as Prisma.CheckInWhereInput })
    case "lead":
      return tx.lead.deleteMany({ where: where as Prisma.LeadWhereInput })
    case "appointment":
      return tx.appointment.deleteMany({ where: where as Prisma.AppointmentWhereInput })
    case "task":
      return tx.task.deleteMany({ where: where as Prisma.TaskWhereInput })
    case "qrSession":
      return tx.qRSession.deleteMany({ where: where as Prisma.QRSessionWhereInput })
    case "leadActivity":
      return tx.leadActivity.deleteMany({ where: where as Prisma.LeadActivityWhereInput })
    // Trainers are export-only (never reset-table): unreachable runtime path.
    case "trainer":
      throw new Error("Trainers are not part of the data reset flow.")
  }
}

function toPreviewCategories(
  ops: ResetOperation[],
  counts: number[]
): ResetPreviewCategory[] {
  return ops.map((op, index) => ({
    category: op.category,
    label: op.label,
    role: op.role,
    dependencyOf: op.dependencyOf,
    count: counts[index],
  }))
}

function sumCounts(counts: number[]): number {
  return counts.reduce((sum, count) => sum + count, 0)
}

/**
 * Count how many records each operation of the plan would delete, scoped to
 * the organization. Purely advisory — the counts are recomputed inside the
 * delete transaction (a deleted organization never sees a stale preview).
 */
export async function previewReset(args: ResetExecuteArgs): Promise<ResetPreview> {
  const ops = buildResetPlan(args.categoryKeys, args.organizationId, args.range, args.timeZone)
  const counts = await Promise.all(
    ops.map((op) => countByOperation(prisma, op))
  )
  return {
    categories: toPreviewCategories(ops, counts),
    total: sumCounts(counts),
  }
}

/**
 * Delete the selected categories (and their dependencies) in FK-safe order.
 *
 * The audit record is written inside the same transaction as the deletes, so
 * "data reset recorded but data still there" (or the reverse) can never occur.
 * The audit row itself is append-only by contract and is never part of any
 * reset scope. The transaction timeout is raised above Prisma's 5s default
 * because the largest tenants can legitimately take longer.
 */
export async function executeReset(args: ResetExecuteArgs): Promise<ResetExecuteResult> {
  const ops = buildResetPlan(args.categoryKeys, args.organizationId, args.range, args.timeZone)

  const { categories, total } = await prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      const counts: number[] = []

      for (const op of ops) {
        const { count } = await deleteByOperation(tx, op)
        counts.push(count)
      }

      await tx.auditLog.create({
        data: {
          organizationId: args.organizationId,
          actorUserId: args.actorUserId ?? null,
          action: AUDIT_ACTIONS.DATA_RESET,
          entityType: "OrganizationData",
          after: {
            categories: ops.map((op, index) => ({
              category: op.category,
              role: op.role,
              count: counts[index],
            })),
            range: args.range,
            total: sumCounts(counts),
          },
        },
      })

      return { categories: toPreviewCategories(ops, counts), total: sumCounts(counts) }
    },
    { timeout: 60_000, maxWait: 10_000 }
  )

  return { deleted: total, categories }
}