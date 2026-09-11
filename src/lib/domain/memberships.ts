import "server-only"

import { cache } from "react"

import { prisma } from "@/lib/prisma"
import {
  getMembershipLifecycle,
  LIFECYCLE_STATUS_ORDER,
  pickPrimaryMembership,
  type MembershipLifecycleRecord,
  type MembershipLifecycleStatus,
} from "@/lib/memberships"

export type {
  MembershipLifecycleRecord,
  MembershipLifecycleStatus,
} from "@/lib/memberships"

export { pickPrimaryMembership }

export type MembershipLifecycleCounts = Record<MembershipLifecycleStatus, number>

function zeroCounts(): MembershipLifecycleCounts {
  return Object.fromEntries(
    LIFECYCLE_STATUS_ORDER.map((s) => [s, 0])
  ) as MembershipLifecycleCounts
}

/**
 * Membership lifecycle statistics for an organization, computed in one pass
 * from the derived statuses so the DB enum never drives business counts.
 *
 * ``records`` counts every membership record; ``members`` counts unique
 * members by the state of their primary/current membership. Renewals are
 * membership records, so a member who renewed twice contributes 3 to
 * `records` but 1 to `members`. Cached per request (React cache).
 */
export const getMembershipLifecycleStats = cache(
  async (
    organizationId: string,
    timeZone: string
  ): Promise<{
    records: MembershipLifecycleCounts
    members: MembershipLifecycleCounts
  }> => {
    const rows = await prisma.membership.findMany({
      where: { organizationId },
      select: {
        id: true,
        memberId: true,
        startDate: true,
        endDate: true,
        status: true,
      },
    })

    const records = zeroCounts()
    const byMember = new Map<string, MembershipLifecycleRecord[]>()
    for (const row of rows) {
      const lifecycle = getMembershipLifecycle({
        startDate: row.startDate,
        endDate: row.endDate,
        status: row.status,
        timeZone,
      })
      records[lifecycle.status] += 1
      const list = byMember.get(row.memberId) ?? []
      list.push(row)
      byMember.set(row.memberId, list)
    }

    const members = zeroCounts()
    for (const list of byMember.values()) {
      const primary = pickPrimaryMembership(list, timeZone)
      if (primary) members[primary.lifecycle.status] += 1
    }

    return { records, members }
  }
)