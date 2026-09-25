import { notFound } from "next/navigation"
import { requireUser } from "@/lib/auth/auth"
import { prisma } from "@/lib/prisma"
import { can } from "@/lib/permissions"
import { TrainerList } from "@/components/trainers/trainer-list"

export default async function TrainersPage() {
  const user = await requireUser()
  if (!can(user, "trainers:view")) notFound()

  const [trainers, availableUsers] = await Promise.all([
    prisma.trainer.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        userId: true,
        bio: true,
        specialties: true,
        active: true,
        user: { select: { id: true, name: true, email: true, role: true } },
        _count: {
          select: { members: true, appointments: true },
        },
      },
    }),
    prisma.user.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true, role: true },
    }),
  ])

  const trainerUserIds = new Set(trainers.map((t) => t.userId))
  const available = availableUsers.filter((u) => !trainerUserIds.has(u.id))

  const canManage = can(user, "trainers:manage")

  const serialized = trainers.map((t) => ({
    id: t.id,
    bio: t.bio,
    specialties: Array.isArray(t.specialties) ? (t.specialties as string[]) : [],
    active: t.active,
    user: { id: t.user.id, name: t.user.name, email: t.user.email, role: t.user.role },
    memberCount: t._count.members,
    appointmentCount: t._count.appointments,
  }))

  return (
    <TrainerList
      trainers={serialized}
      canManage={canManage}
      availableUsers={available.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
      }))}
    />
  )
}