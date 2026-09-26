/**
 * Safe demo-data cleanup script.
 *
 * Deletes ONLY business/demo records (members, plans, payments, leads, etc.)
 * while PRESERVING:
 *   - The Organization
 *   - All Users (authentication accounts)
 *   - Branch records (a branch is configuration, never business data)
 *   - Trainer records
 *
 * Safe to run multiple times (idempotent).
 * Does NOT drop tables, reset the database, or touch auth credentials.
 */
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  console.log("Starting safe demo-data cleanup...")
  console.log("Preserving: Organization, Users, Branches, Trainers")
  console.log("")

  const org = await prisma.organization.findFirst()
  if (!org) {
    console.log("No organization found — nothing to clean.")
    return
  }

  console.log(`Organization preserved: ${org.name} (${org.id})`)

  const users = await prisma.user.findMany({
    where: { organizationId: org.id },
    select: { id: true, name: true, email: true, role: true },
  })
  console.log(`Users preserved (${users.length}):`)
  for (const u of users) {
    console.log(`  - ${u.name} <${u.email}> [${u.role}]`)
  }

  console.log("")
  console.log("Deleting demo business records...")

  // Delete in dependency-safe order (children before parents).
  // Each deleteMany is scoped to this organization.
  const results: [string, number][] = []

  const auditLogs = await prisma.auditLog.deleteMany({ where: { organizationId: org.id } })
  results.push(["AuditLog", auditLogs.count])

  const notifications = await prisma.notification.deleteMany({ where: { organizationId: org.id } })
  results.push(["Notification", notifications.count])

  const tasks = await prisma.task.deleteMany({ where: { organizationId: org.id } })
  results.push(["Task", tasks.count])

  const appointments = await prisma.appointment.deleteMany({ where: { organizationId: org.id } })
  results.push(["Appointment", appointments.count])

  const leadActivities = await prisma.leadActivity.deleteMany({ where: { organizationId: org.id } })
  results.push(["LeadActivity", leadActivities.count])

  const leads = await prisma.lead.deleteMany({ where: { organizationId: org.id } })
  results.push(["Lead", leads.count])

  const checkIns = await prisma.checkIn.deleteMany({ where: { organizationId: org.id } })
  results.push(["CheckIn", checkIns.count])

  const qrSessions = await prisma.qRSession.deleteMany({ where: { organizationId: org.id } })
  results.push(["QRSession", qrSessions.count])

  const payments = await prisma.payment.deleteMany({ where: { organizationId: org.id } })
  results.push(["Payment", payments.count])

  const memberships = await prisma.membership.deleteMany({ where: { organizationId: org.id } })
  results.push(["Membership", memberships.count])

  const plans = await prisma.membershipPlan.deleteMany({ where: { organizationId: org.id } })
  results.push(["MembershipPlan", plans.count])

  const members = await prisma.member.deleteMany({ where: { organizationId: org.id } })
  results.push(["Member", members.count])

  console.log("")
  console.log("Cleanup summary:")
  let totalDeleted = 0
  for (const [model, count] of results) {
    console.log(`  ${model}: ${count} deleted`)
    totalDeleted += count
  }
  console.log(`  Total: ${totalDeleted} records deleted`)
  console.log("")
  console.log("Safe cleanup complete. Organization and all user accounts preserved.")
}

main()
  .catch((e) => {
    console.error("Cleanup failed:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
