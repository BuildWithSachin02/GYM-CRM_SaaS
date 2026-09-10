/**
 * Idempotent demo-data seed.
 *
 * - Finds or creates the Organization and User accounts by email (never deletes them).
 * - Preserves existing user password hashes (never overwrites).
 * - Deletes and recreates ALL business data (members, plans, payments, leads, etc.)
 *   so re-running produces a clean, deterministic dataset.
 *
 * Safe to run multiple times. Does NOT touch auth credentials after first creation.
 */
import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"
import { createHash, randomBytes } from "node:crypto"

const prisma = new PrismaClient()

const DAY = 24 * 60 * 60 * 1000
const now = new Date()
const daysFromNow = (n: number) => new Date(now.getTime() + n * DAY)
const hoursFromNow = (n: number) => new Date(now.getTime() + n * 60 * 60 * 1000)
const inr = (rupees: number) => Math.round(rupees * 100)

function dayKey(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// ── Deterministic helpers (no Math.random) ──────────────────────────
const DOBS = [
  new Date(1990, 2, 15),
  new Date(1993, 7, 22),
  new Date(1988, 0, 10),
  new Date(1995, 4, 5),
  new Date(1991, 9, 18),
  new Date(1994, 1, 28),
  new Date(1989, 6, 12),
  new Date(1996, 11, 1),
  new Date(1992, 3, 25),
  new Date(1997, 8, 8),
  new Date(1987, 5, 30),
  new Date(1990, 10, 14),
  new Date(1993, 0, 20),
  new Date(1986, 7, 7),
  new Date(1995, 2, 3),
  new Date(1988, 9, 11),
]

const ADDRESSES = [
  "Flat 42, MG Road, Pune",
  "12B, FC Road, Pune",
  "Apt 7, Koregaon Park, Pune",
  "305, Aundh, Pune",
  "18, Baner, Pune",
]

const EMERGENCY_PHONES = [
  "+91 91000 50001",
  "+91 91000 50002",
  "+91 91000 50003",
  "+91 91000 50004",
  "+91 91000 50005",
  "+91 91000 50006",
  "+91 91000 50007",
  "+91 91000 50008",
  "+91 91000 50009",
  "+91 91000 50010",
  "+91 91000 50011",
  "+91 91000 50012",
  "+91 91000 50013",
  "+91 91000 50014",
  "+91 91000 50015",
  "+91 91000 50016",
]

const PAYMENT_METHODS = ["CASH", "UPI", "CARD", "BANK_TRANSFER"] as const
const TXN_REFS = [
  "TXN900100001",
  "TXN900100002",
  "TXN900100003",
  "TXN900100004",
  "TXN900100005",
  "TXN900100006",
  "TXN900100007",
  "TXN900100008",
  "TXN900100009",
  "TXN900100010",
  "TXN900100011",
  "TXN900100012",
  "TXN900100013",
  "TXN900100014",
  "TXN900100015",
  "TXN900100016",
]

async function findOrCreateOrg() {
  const existing = await prisma.organization.findUnique({ where: { slug: "kings-gym" } })
  if (existing) return existing

  return prisma.organization.create({
    data: {
      name: "King's Gym",
      slug: "kings-gym",
      phone: "+91 98765 43210",
      email: "hello@kingsgym.in",
      address: "2nd Floor, City Mart Complex, MG Road",
      city: "Pune",
      state: "Maharashtra",
      country: "India",
      timezone: "Asia/Kolkata",
      currency: "INR",
    },
  })
}

type UserSpec = {
  name: string
  email: string
  phone: string
  role: "OWNER" | "ADMIN" | "RECEPTIONIST" | "TRAINER"
}

async function findOrCreateUser(orgId: string, spec: UserSpec, passwordHash: string) {
  const existing = await prisma.user.findUnique({ where: { email: spec.email } })
  if (existing) return existing

  return prisma.user.create({
    data: {
      organizationId: orgId,
      name: spec.name,
      email: spec.email,
      phone: spec.phone,
      passwordHash,
      role: spec.role,
    },
  })
}

async function findOrCreateTrainer(orgId: string, userId: string, bio: string, specialties: string[]) {
  const existing = await prisma.trainer.findUnique({ where: { userId } })
  if (existing) return existing

  return prisma.trainer.create({
    data: {
      organizationId: orgId,
      userId,
      bio,
      specialties,
      active: true,
    },
  })
}

async function main() {
  console.log("Seeding King's Gym demo data (idempotent)...")

  // ── Organization ────────────────────────────────────────────────
  const org = await findOrCreateOrg()
  console.log(`Organization: ${org.name} (${org.id})`)

  // ── Location ────────────────────────────────────────────────────
  const location = await prisma.gymLocation.upsert({
    where: { organizationId_name: { organizationId: org.id, name: "King's Gym — Main" } },
    update: {},
    create: {
      organizationId: org.id,
      name: "King's Gym — Main",
      address: "2nd Floor, City Mart Complex, MG Road",
      city: "Pune",
      state: "Maharashtra",
    },
  })

  // ── Password ────────────────────────────────────────────────────
  const seedPassword = process.env.SEED_OWNER_PASSWORD
  if (!seedPassword || seedPassword.length < 8) {
    console.error("SEED_OWNER_PASSWORD is required (min 8 characters) to seed demo data.")
    process.exit(1)
  }
  const passwordHash = await bcrypt.hash(seedPassword, 10)

  // ── Users (find-or-create — NEVER delete or overwrite existing) ──
  const owner = await findOrCreateUser(org.id, {
    name: "Rohan Malhotra",
    email: "owner@kingsgym.in",
    phone: "+91 98765 43210",
    role: "OWNER",
  }, passwordHash)

  const admin = await findOrCreateUser(org.id, {
    name: "Priya Sharma",
    email: "admin@kingsgym.in",
    phone: "+91 98220 11223",
    role: "ADMIN",
  }, passwordHash)

  const reception = await findOrCreateUser(org.id, {
    name: "Amit Kumar",
    email: "frontdesk@kingsgym.in",
    phone: "+91 98900 44556",
    role: "RECEPTIONIST",
  }, passwordHash)

  const trainerUser1 = await findOrCreateUser(org.id, {
    name: "Vikram Singh",
    email: "vikram@kingsgym.in",
    phone: "+91 99600 77889",
    role: "TRAINER",
  }, passwordHash)

  const trainerUser2 = await findOrCreateUser(org.id, {
    name: "Neha Kapoor",
    email: "neha@kingsgym.in",
    phone: "+91 99230 55667",
    role: "TRAINER",
  }, passwordHash)

  // ── Trainers (find-or-create — linked to users) ─────────────────
  const trainer1 = await findOrCreateTrainer(org.id, trainerUser1.id,
    "Certified strength & conditioning coach, 8 years experience.",
    ["Strength", "Powerlifting"]
  )
  const trainer2 = await findOrCreateTrainer(org.id, trainerUser2.id,
    "Functional fitness and yoga specialist, 6 years experience.",
    ["Functional Training", "Yoga"]
  )

  // ── Delete all business data (preserve org + users + trainers + locations) ──
  console.log("Clearing existing business data...")
  await prisma.$transaction([
    prisma.auditLog.deleteMany({ where: { organizationId: org.id } }),
    prisma.notification.deleteMany({ where: { organizationId: org.id } }),
    prisma.task.deleteMany({ where: { organizationId: org.id } }),
    prisma.appointment.deleteMany({ where: { organizationId: org.id } }),
    prisma.leadActivity.deleteMany({ where: { organizationId: org.id } }),
    prisma.lead.deleteMany({ where: { organizationId: org.id } }),
    prisma.checkIn.deleteMany({ where: { organizationId: org.id } }),
    prisma.qRSession.deleteMany({ where: { organizationId: org.id } }),
    prisma.payment.deleteMany({ where: { organizationId: org.id } }),
    prisma.membership.deleteMany({ where: { organizationId: org.id } }),
    prisma.membershipPlan.deleteMany({ where: { organizationId: org.id } }),
    prisma.member.deleteMany({ where: { organizationId: org.id } }),
  ])

  // ── Membership Plans ────────────────────────────────────────────
  const monthly = await prisma.membershipPlan.create({
    data: {
      organizationId: org.id, name: "Monthly", billingInterval: "MONTHLY",
      priceMinor: inr(1299), durationDays: 30,
      description: "1 month full gym access (all locations).", active: true,
    },
  })
  const quarterly = await prisma.membershipPlan.create({
    data: {
      organizationId: org.id, name: "Quarterly", billingInterval: "QUARTERLY",
      priceMinor: inr(3499), durationDays: 90,
      description: "3 months full gym access + 1 free trainer session.", active: true,
    },
  })
  const halfYearly = await prisma.membershipPlan.create({
    data: {
      organizationId: org.id, name: "Half Yearly", billingInterval: "HALF_YEARLY",
      priceMinor: inr(6499), durationDays: 180,
      description: "6 months full gym access + 2 free trainer sessions.", active: true,
    },
  })
  const yearly = await prisma.membershipPlan.create({
    data: {
      organizationId: org.id, name: "Yearly", billingInterval: "YEARLY",
      priceMinor: inr(11999), durationDays: 365,
      description: "12 months full gym access + 4 free trainer sessions.", active: true,
    },
  })

  // ── Members ─────────────────────────────────────────────────────
  type MemberSeed = {
    first: string
    last: string
    phone: string
    email?: string
    gender: "MALE" | "FEMALE" | "OTHER"
    plan: typeof monthly | typeof quarterly | typeof halfYearly | typeof yearly
    startDaysAgo: number
    endDaysFromNow: number
    trainerId?: string
    source?: "WALK_IN" | "WEBSITE" | "FACEBOOK" | "INSTAGRAM" | "GOOGLE"
  }

  const memberSeeds: MemberSeed[] = [
    // Active members
    { first: "Arjun", last: "Patel", phone: "+91 90000 10001", email: "arjun.patel@example.com", gender: "MALE", plan: monthly, startDaysAgo: 210, endDaysFromNow: 15, trainerId: trainer1.id, source: "WALK_IN" },
    { first: "Sneha", last: "Iyer", phone: "+91 90000 10002", email: "sneha.iyer@example.com", gender: "FEMALE", plan: yearly, startDaysAgo: 300, endDaysFromNow: 60, trainerId: trainer2.id, source: "INSTAGRAM" },
    { first: "Rahul", last: "Deshmukh", phone: "+91 90000 10003", email: "rahul.d@example.com", gender: "MALE", plan: quarterly, startDaysAgo: 45, endDaysFromNow: 44, trainerId: trainer1.id, source: "GOOGLE" },
    { first: "Pooja", last: "Nair", phone: "+91 90000 10004", email: "pooja.nair@example.com", gender: "FEMALE", plan: halfYearly, startDaysAgo: 120, endDaysFromNow: 60, source: "WALK_IN" },
    { first: "Karan", last: "Mehta", phone: "+91 90000 10005", email: "karan.mehta@example.com", gender: "MALE", plan: monthly, startDaysAgo: 200, endDaysFromNow: 7, trainerId: trainer1.id, source: "WEBSITE" },
    { first: "Divya", last: "Reddy", phone: "+91 90000 10006", email: "divya.reddy@example.com", gender: "FEMALE", plan: quarterly, startDaysAgo: 30, endDaysFromNow: 60, trainerId: trainer2.id, source: "FACEBOOK" },
    { first: "Sanjay", last: "Kulkarni", phone: "+91 90000 10007", email: "sanjay.k@example.com", gender: "MALE", plan: yearly, startDaysAgo: 260, endDaysFromNow: 105, source: "WALK_IN" },
    { first: "Ananya", last: "Joshi", phone: "+91 90000 10008", email: "ananya.joshi@example.com", gender: "FEMALE", plan: monthly, startDaysAgo: 245, endDaysFromNow: 3, trainerId: trainer2.id, source: "INSTAGRAM" },
    { first: "Vivek", last: "Shah", phone: "+91 90000 10009", email: "vivek.shah@example.com", gender: "MALE", plan: halfYearly, startDaysAgo: 90, endDaysFromNow: 90, source: "GOOGLE" },
    { first: "Meera", last: "Bhat", phone: "+91 90000 10010", email: "meera.bhat@example.com", gender: "FEMALE", plan: quarterly, startDaysAgo: 60, endDaysFromNow: 30, source: "FACEBOOK" },
    // Expired members
    { first: "Rakesh", last: "Gupta", phone: "+91 90000 10011", email: "rakesh.gupta@example.com", gender: "MALE", plan: monthly, startDaysAgo: 90, endDaysFromNow: -60, source: "WALK_IN" },
    { first: "Farhan", last: "Khan", phone: "+91 90000 10012", email: "farhan.khan@example.com", gender: "MALE", plan: quarterly, startDaysAgo: 160, endDaysFromNow: -50, trainerId: trainer1.id, source: "GOOGLE" },
    { first: "Kavita", last: "Yadav", phone: "+91 90000 10013", email: "kavita.yadav@example.com", gender: "FEMALE", plan: monthly, startDaysAgo: 60, endDaysFromNow: -30, source: "WALK_IN" },
    { first: "Rohit", last: "Chavan", phone: "+91 90000 10014", email: "rohit.chavan@example.com", gender: "MALE", plan: halfYearly, startDaysAgo: 200, endDaysFromNow: -20, source: "INSTAGRAM" },
    // Inactive members
    { first: "Nikita", last: "Sawant", phone: "+91 90000 10015", email: "nikita.sawant@example.com", gender: "FEMALE", plan: monthly, startDaysAgo: 300, endDaysFromNow: -120, source: "WEBSITE" },
    { first: "Gaurav", last: "Bansal", phone: "+91 90000 10016", email: "gaurav.bansal@example.com", gender: "MALE", plan: monthly, startDaysAgo: 180, endDaysFromNow: -150, source: "FACEBOOK" },
  ]

  const members = []
  for (let i = 0; i < memberSeeds.length; i++) {
    const s = memberSeeds[i]
    const member = await prisma.member.create({
      data: {
        organizationId: org.id,
        primaryLocationId: location.id,
        firstName: s.first,
        lastName: s.last,
        phone: s.phone,
        email: s.email,
        gender: s.gender,
        dateOfBirth: DOBS[i],
        address: ADDRESSES[i % ADDRESSES.length],
        emergencyContactName: "Family",
        emergencyContactPhone: EMERGENCY_PHONES[i],
        trainerId: s.trainerId ?? null,
        signupSource: s.source ?? null,
        status: s.endDaysFromNow < -90 ? "INACTIVE" : "ACTIVE",
      },
    })

    const startDate = daysFromNow(-s.startDaysAgo)
    const endDate = daysFromNow(s.endDaysFromNow)

    const membership = await prisma.membership.create({
      data: {
        organizationId: org.id,
        memberId: member.id,
        planId: s.plan.id,
        status: s.endDaysFromNow < 0 ? "EXPIRED" : "ACTIVE",
        startDate,
        endDate,
        amountMinor: s.plan.priceMinor,
      },
    })

    await prisma.payment.create({
      data: {
        organizationId: org.id,
        memberId: member.id,
        membershipId: membership.id,
        amountMinor: s.plan.priceMinor,
        method: PAYMENT_METHODS[i % PAYMENT_METHODS.length],
        reference: TXN_REFS[i],
        paymentDate: startDate,
        recordedById: [owner.id, admin.id, reception.id][i % 3],
        notes: `Initial payment — ${s.plan.name} plan`,
      },
    })

    members.push(member)
  }

  // ── Attendance ──────────────────────────────────────────────────
  const todayKeyVal = dayKey(now)
  for (let i = 0; i < memberSeeds.length; i++) {
    const s = memberSeeds[i]
    if (s.endDaysFromNow <= 0) continue // only active members

    // Today's check-in: all except every 3rd
    if (i % 3 !== 2) {
      await prisma.checkIn.create({
        data: {
          organizationId: org.id,
          memberId: members[i].id,
          locationId: location.id,
          source: "MANUAL",
          dayKey: todayKeyVal,
          checkedInAt: new Date(now.getTime() - i * 37 * 60 * 1000),
        },
      })
    }

    // Trailing 14 days
    for (let d = 1; d <= 14; d++) {
      if ((i + d) % 3 !== 0) {
        const day = daysFromNow(-d)
        await prisma.checkIn.create({
          data: {
            organizationId: org.id,
            memberId: members[i].id,
            locationId: location.id,
            source: "MANUAL",
            dayKey: dayKey(day),
            checkedInAt: day,
          },
        })
      }
    }
  }

  // ── Leads + Activities ──────────────────────────────────────────
  type LeadSeed = {
    name: string
    phone: string
    email?: string
    source: "WEBSITE" | "INSTAGRAM" | "FACEBOOK" | "WHATSAPP" | "GOOGLE" | "WALK_IN" | "MANUAL"
    stage: "NEW" | "CONTACTED" | "VISIT_SCHEDULED" | "VISIT_DONE" | "CONVERTED" | "LOST"
    followUpInDays?: number
    plan?: typeof monthly | typeof quarterly | typeof halfYearly | typeof yearly
    ownerId?: string
  }

  const leadSeeds: LeadSeed[] = [
    { name: "Aditya Ranade", phone: "+91 91000 20001", email: "aditya.r@example.com", source: "WEBSITE", stage: "NEW", followUpInDays: 0, plan: quarterly, ownerId: reception.id },
    { name: "Ishita Verma", phone: "+91 91000 20002", email: "ishita.v@example.com", source: "INSTAGRAM", stage: "CONTACTED", followUpInDays: 1, plan: monthly, ownerId: reception.id },
    { name: "Manish Agarwal", phone: "+91 91000 20003", email: "manish.a@example.com", source: "GOOGLE", stage: "VISIT_SCHEDULED", followUpInDays: 2, plan: halfYearly, ownerId: reception.id },
    { name: "Sanya Malhotra", phone: "+91 91000 20004", email: "sanya.m@example.com", source: "WHATSAPP", stage: "VISIT_SCHEDULED", followUpInDays: 0, plan: quarterly, ownerId: admin.id },
    { name: "Deepak Rao", phone: "+91 91000 20005", email: "deepak.r@example.com", source: "WALK_IN", stage: "CONTACTED", followUpInDays: 3, plan: yearly, ownerId: reception.id },
    { name: "Ritika Jain", phone: "+91 91000 20006", email: "ritika.j@example.com", source: "FACEBOOK", stage: "NEW", followUpInDays: 0, plan: monthly, ownerId: reception.id },
    { name: "Siddharth Kulkarni", phone: "+91 91000 20007", email: "siddharth.k@example.com", source: "GOOGLE", stage: "VISIT_DONE", followUpInDays: 1, plan: halfYearly, ownerId: admin.id },
    { name: "Tanvi Pradhan", phone: "+91 91000 20008", email: "tanvi.p@example.com", source: "INSTAGRAM", stage: "CONTACTED", followUpInDays: -1, plan: quarterly, ownerId: reception.id },
    { name: "Harsh Vora", phone: "+91 91000 20009", email: "harsh.v@example.com", source: "MANUAL", stage: "NEW", followUpInDays: -2, plan: monthly, ownerId: reception.id },
    { name: "Nidhi Chari", phone: "+91 91000 20010", email: "nidhi.c@example.com", source: "FACEBOOK", stage: "LOST", plan: monthly, ownerId: reception.id },
    // Converted lead — linked to Sneha Iyer
    { name: "Sneha Iyer", phone: "+91 90000 10002", email: "sneha.iyer@example.com", source: "INSTAGRAM", stage: "CONVERTED", plan: yearly, ownerId: reception.id },
  ]

  const leadIds: string[] = []
  for (const s of leadSeeds) {
    let convertedMemberId: string | undefined
    let convertedAt: Date | null = null
    if (s.stage === "CONVERTED" && s.email) {
      const m = await prisma.member.findFirst({ where: { organizationId: org.id, email: s.email } })
      if (m) {
        convertedMemberId = m.id
        convertedAt = daysFromNow(-60)
      }
    }

    const lead = await prisma.lead.create({
      data: {
        organizationId: org.id,
        locationId: location.id,
        name: s.name,
        phone: s.phone,
        email: s.email ?? null,
        source: s.source,
        stage: s.stage,
        interestedPlanId: s.plan?.id ?? null,
        ownerUserId: s.ownerId ?? null,
        followUpDate: s.followUpInDays !== undefined ? daysFromNow(s.followUpInDays) : null,
        notes: s.source === "WALK_IN" ? "Walked in during evening rush, seemed very interested." : null,
        convertedMemberId: convertedMemberId ?? null,
        convertedAt,
      },
    })
    leadIds.push(lead.id)

    const activityType =
      s.stage === "CONVERTED" ? "NOTE" :
      s.stage === "VISIT_DONE" ? "VISIT" :
      s.stage === "VISIT_SCHEDULED" ? "CALL" :
      s.stage === "CONTACTED" ? "CALL" :
      "NOTE"

    await prisma.leadActivity.create({
      data: {
        organizationId: org.id,
        leadId: lead.id,
        type: activityType as "NOTE" | "VISIT" | "CALL",
        body: `Lead created from ${s.source}.${s.followUpInDays === 0 ? " Follow-up due today." : ""}`.trim(),
        createdById: reception.id,
        activityDate: daysFromNow(-1),
      },
    })
  }

  // ── Appointments ────────────────────────────────────────────────
  await prisma.appointment.createMany({
    data: [
      {
        organizationId: org.id, locationId: location.id,
        memberId: members[0].id, trainerId: trainer1.id, staffId: trainerUser1.id,
        startsAt: hoursFromNow(1), endsAt: hoursFromNow(2),
        status: "SCHEDULED", notes: "Strength assessment",
      },
      {
        organizationId: org.id, locationId: location.id,
        memberId: members[5].id, trainerId: trainer2.id, staffId: trainerUser2.id,
        startsAt: hoursFromNow(4), endsAt: hoursFromNow(5),
        status: "SCHEDULED", notes: "Functional training session",
      },
      {
        organizationId: org.id, locationId: location.id,
        memberId: members[7].id, trainerId: trainer2.id, staffId: trainerUser2.id,
        startsAt: hoursFromNow(28), endsAt: hoursFromNow(29),
        status: "SCHEDULED", notes: "Yoga alignment review",
      },
      {
        organizationId: org.id, locationId: location.id,
        leadId: leadIds[2], trainerId: trainer1.id, staffId: trainerUser1.id,
        startsAt: hoursFromNow(3), endsAt: hoursFromNow(3.5),
        status: "SCHEDULED", notes: "Gym tour + plan discussion",
      },
      {
        organizationId: org.id, locationId: location.id,
        leadId: leadIds[3], staffId: admin.id,
        startsAt: hoursFromNow(-2), endsAt: hoursFromNow(-1),
        status: "COMPLETED", notes: "Intro visit completed",
      },
    ],
  })

  // ── Tasks ───────────────────────────────────────────────────────
  await prisma.task.createMany({
    data: [
      {
        organizationId: org.id, title: "Call Aditya Ranade — new website lead",
        description: "Introduce membership plans and schedule a visit.",
        dueDate: daysFromNow(0), status: "TODO",
        assigneeId: reception.id, createdById: admin.id, leadId: leadIds[0],
      },
      {
        organizationId: org.id, title: "Follow up with Sneha Iyer — membership expires soon",
        description: "Sneha's yearly membership expires in 60 days. Propose renewal or upgrade.",
        dueDate: daysFromNow(0), status: "TODO",
        assigneeId: reception.id, createdById: admin.id, memberId: members[1].id,
      },
      {
        organizationId: org.id, title: "Call Rakesh Gupta — expired 60 days ago",
        description: "Re-engage lapsed member with a comeback offer.",
        dueDate: daysFromNow(-2), status: "TODO",
        assigneeId: reception.id, createdById: admin.id, memberId: members[10].id,
      },
      {
        organizationId: org.id, title: "Renewal reminder — Farhan Khan",
        description: "Quarterly plan expired. Share renewal discount.",
        dueDate: daysFromNow(-1), status: "IN_PROGRESS",
        assigneeId: reception.id, createdById: admin.id, memberId: members[11].id,
      },
      {
        organizationId: org.id, title: "Confirm tomorrow's PT slot for Pooja Nair",
        description: "Verify appointment with trainer Neha.",
        dueDate: daysFromNow(1), status: "TODO",
        assigneeId: reception.id, createdById: admin.id, memberId: members[3].id,
      },
      {
        organizationId: org.id, title: "Call Ritika Jain — facebook lead follow-up",
        description: "Last contact 3 days ago; nurture pipeline.",
        dueDate: daysFromNow(1), status: "TODO",
        assigneeId: reception.id, createdById: admin.id, leadId: leadIds[5],
      },
    ],
  })

  // ── QR Session ──────────────────────────────────────────────────
  const demoQrToken = randomBytes(24).toString("hex")
  const demoQrHash = createHash("sha256").update(demoQrToken).digest("hex")
  await prisma.qRSession.create({
    data: {
      organizationId: org.id, locationId: location.id,
      label: "Front desk — active demo session",
      tokenHash: demoQrHash,
      expiresAt: hoursFromNow(8),
      createdById: admin.id,
    },
  })
  console.log(`Active QR token (dev demo): ${demoQrToken}`)

  // ── Notifications ───────────────────────────────────────────────
  await prisma.notification.createMany({
    data: [
      {
        organizationId: org.id, userId: owner.id, type: "MEMBERSHIP_EXPIRING",
        title: "3 memberships expiring this week",
        body: "Ananya Joshi, Karan Mehta and Arjun Patel expire within 7 days.",
        link: "/dashboard/members?filter=expiring", isRead: false,
        createdAt: daysFromNow(-1),
      },
      {
        organizationId: org.id, userId: owner.id, type: "NEW_LEAD",
        title: "New lead: Aditya Ranade",
        body: "Website lead is waiting for a follow-up.",
        link: "/dashboard/leads", isRead: false,
        createdAt: hoursFromNow(-3),
      },
      {
        organizationId: org.id, userId: owner.id, type: "PAYMENT_RECORDED",
        title: "Payment received: ₹1,299",
        body: "Monthly membership payment recorded today.",
        link: "/dashboard/payments", isRead: false,
        createdAt: hoursFromNow(-5),
      },
      {
        organizationId: org.id, userId: owner.id, type: "TASK_OVERDUE",
        title: "Overdue: Call Rakesh Gupta",
        body: "Re-engagement call is 2 days overdue.",
        link: "/dashboard/tasks", isRead: true,
        createdAt: daysFromNow(-2),
      },
      {
        organizationId: org.id, userId: admin.id, type: "NEW_LEAD",
        title: "New lead: Ritika Jain",
        body: "Facebook lead assigned to front desk.",
        link: "/dashboard/leads", isRead: false,
        createdAt: hoursFromNow(-6),
      },
      {
        organizationId: org.id, userId: reception.id, type: "TASK_ASSIGNED",
        title: "Task assigned: Call Aditya Ranade",
        body: "Follow-up on new website lead.",
        link: "/dashboard/tasks", isRead: false,
        createdAt: hoursFromNow(-2),
      },
    ],
  })

  // ── Audit Log ───────────────────────────────────────────────────
  await prisma.auditLog.createMany({
    data: [
      {
        organizationId: org.id, actorUserId: admin.id,
        action: "member.created", entityType: "Member", entityId: members[0].id,
        after: { firstName: members[0].firstName },
        createdAt: daysFromNow(-20),
      },
      {
        organizationId: org.id, actorUserId: admin.id,
        action: "payment.recorded", entityType: "Payment", entityId: null,
        after: { amountMinor: 349900, method: "UPI" },
        createdAt: daysFromNow(-2),
      },
      {
        organizationId: org.id, actorUserId: admin.id,
        action: "lead.converted", entityType: "Lead", entityId: null,
        after: { memberCreated: true },
        createdAt: daysFromNow(-60),
      },
    ],
  })

  // ── Summary ─────────────────────────────────────────────────────
  const activeCount = memberSeeds.filter((s) => s.endDaysFromNow > 0).length
  const expiredCount = memberSeeds.filter((s) => s.endDaysFromNow <= 0 && s.endDaysFromNow > -90).length
  const inactiveCount = memberSeeds.filter((s) => s.endDaysFromNow <= -90).length

  console.log("")
  console.log("Seed complete.")
  console.log("")
  console.log(`Members: ${memberSeeds.length} total (${activeCount} active, ${expiredCount} expired, ${inactiveCount} inactive)`)
  console.log(`Plans: 4 (Monthly, Quarterly, Half Yearly, Yearly)`)
  console.log(`Memberships: ${memberSeeds.length}`)
  console.log(`Payments: ${memberSeeds.length}`)
  console.log(`Leads: ${leadSeeds.length} (1 converted)`)
  console.log(`Appointments: 5 (4 scheduled, 1 completed)`)
  console.log(`Tasks: 6 (4 todo, 1 in-progress, 0 completed)`)
  console.log(`Notifications: 6`)
  console.log("")
  console.log("Demo login — password set via SEED_OWNER_PASSWORD:")
  console.log("  owner@kingsgym.in")
  console.log("  admin@kingsgym.in")
  console.log("  frontdesk@kingsgym.in")
  console.log("  vikram@kingsgym.in")
  console.log("  neha@kingsgym.in")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
