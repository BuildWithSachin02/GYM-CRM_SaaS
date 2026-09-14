import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { requireUser } from "@/lib/auth/auth"
import { prisma } from "@/lib/prisma"
import { can } from "@/lib/permissions"

import { LeadProfile } from "@/components/leads/lead-profile"

type PageProps = {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params
  const user = await requireUser()

  const lead = await prisma.lead.findFirst({
    where: { id, organizationId: user.organizationId, deletedAt: null },
    select: { name: true },
  })

  return {
    title: lead ? lead.name : "Lead",
  }
}

export default async function LeadDetailPage({ params }: PageProps) {
  const { id } = await params
  const user = await requireUser()

  const lead = await prisma.lead.findFirst({
    where: { id, organizationId: user.organizationId, deletedAt: null },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      source: true,
      sourceDetail: true,
      stage: true,
      followUpDate: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
      ownerUser: {
        select: { id: true, name: true },
      },
      interestedPlan: {
        select: {
          id: true,
          name: true,
          priceMinor: true,
          durationDays: true,
          billingInterval: true,
        },
      },
      leadActivities: {
        orderBy: { activityDate: "desc" },
        take: 100,
        select: {
          id: true,
          type: true,
          body: true,
          activityDate: true,
          createdBy: {
            select: { name: true },
          },
        },
      },
      _count: {
        select: { leadActivities: true, appointments: true },
      },
    },
  })

  if (!lead) {
    notFound()
  }

  const plans = await prisma.membershipPlan.findMany({
    where: { organizationId: user.organizationId, active: true },
    select: {
      id: true,
      name: true,
      priceMinor: true,
      durationDays: true,
      billingInterval: true,
    },
    orderBy: { name: "asc" },
  })

  const serialized = {
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    source: lead.source,
    sourceDetail: lead.sourceDetail,
    stage: lead.stage,
    followUpDate: lead.followUpDate?.toISOString() ?? null,
    notes: lead.notes,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
    owner: lead.ownerUser,
    interestedPlan: lead.interestedPlan,
    activities: lead.leadActivities.map((a) => ({
      id: a.id,
      type: a.type,
      body: a.body,
      activityDate: a.activityDate.toISOString(),
      actorName: a.createdBy?.name ?? "Unknown",
    })),
    activityCount: lead._count.leadActivities,
    appointmentCount: lead._count.appointments,
  }

  return (
    <LeadProfile
      lead={serialized}
      plans={plans}
      canUpdate={can(user, "leads:update")}
      canManage={can(user, "leads:manage")}
      canConvert={can(user, "leads:convert")}
    />
  )
}