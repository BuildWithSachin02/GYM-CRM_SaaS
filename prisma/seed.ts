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
  return d.toISOString().slice(0, 10)
}

async function main() {
  console.log("Seeding King's Gym demo data...")

  // Clean existing data (idempotent re-runs)
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.task.deleteMany(),
    prisma.appointment.deleteMany(),
    prisma.leadActivity.deleteMany(),
    prisma.lead.deleteMany(),
    prisma.checkIn.deleteMany(),
    prisma.qRSession.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.membership.deleteMany(),
    prisma.membershipPlan.deleteMany(),
    prisma.member.deleteMany(),
    prisma.trainer.deleteMany(),
    prisma.user.deleteMany(),
    prisma.gymLocation.deleteMany(),
    prisma.organization.deleteMany(),
  ])

  // ---------------------------------------------------------------
  // Organization & Location
  // ---------------------------------------------------------------
  const org = await prisma.organization.create({
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

  const location = await prisma.gymLocation.create({
    data: {
      organizationId: org.id,
      name: "King's Gym — Main",
      address: "2nd Floor, City Mart Complex, MG Road",
      city: "Pune",
      state: "Maharashtra",
    },
  })

  // ---------------------------------------------------------------
  // Staff / Users
  // ---------------------------------------------------------------
  const passwordHash = await bcrypt.hash("Kings@123", 10)

  const owner = await prisma.user.create({
    data: {
      organizationId: org.id,
      name: "Rohan Malhotra",
      email: "owner@kingsgym.in",
      phone: "+91 98765 43210",
      passwordHash,
      role: "OWNER",
    },
  })

  const admin = await prisma.user.create({
    data: {
      organizationId: org.id,
      name: "Priya Sharma",
      email: "admin@kingsgym.in",
      phone: "+91 98220 11223",
      passwordHash,
      role: "ADMIN",
    },
  })

  const reception = await prisma.user.create({
    data: {
      organizationId: org.id,
      name: "Amit Kumar",
      email: "frontdesk@kingsgym.in",
      phone: "+91 98900 44556",
      passwordHash,
      role: "RECEPTIONIST",
    },
  })

  const trainerUser1 = await prisma.user.create({
    data: {
      organizationId: org.id,
      name: "Vikram Singh",
      email: "vikram@kingsgym.in",
      phone: "+91 99600 77889",
      passwordHash,
      role: "TRAINER",
    },
  })

  const trainerUser2 = await prisma.user.create({
    data: {
      organizationId: org.id,
      name: "Neha Kapoor",
      email: "neha@kingsgym.in",
      phone: "+91 99230 55667",
      passwordHash,
      role: "TRAINER",
    },
  })

  const trainer1 = await prisma.trainer.create({
    data: {
      organizationId: org.id,
      userId: trainerUser1.id,
      bio: "Certified strength & conditioning coach, 8 years experience.",
      specialties: ["Strength", "Powerlifting"],
      active: true,
    },
  })

  const trainer2 = await prisma.trainer.create({
    data: {
      organizationId: org.id,
      userId: trainerUser2.id,
      bio: "Functional fitness and yoga specialist, 6 years experience.",
      specialties: ["Functional Training", "Yoga"],
      active: true,
    },
  })

  // ---------------------------------------------------------------
  // Membership Plans (amounts in paise)
  // ---------------------------------------------------------------
  const plans = await Promise.all([
    prisma.membershipPlan.create({
      data: {
        organizationId: org.id,
        name: "Monthly",
        billingInterval: "MONTHLY",
        priceMinor: inr(1299),
        durationDays: 30,
        description: "1 month full gym access (all locations).",
        active: true,
      },
    }),
    prisma.membershipPlan.create({
      data: {
        organizationId: org.id,
        name: "Quarterly",
        billingInterval: "QUARTERLY",
        priceMinor: inr(3499),
        durationDays: 90,
        description: "3 months full gym access + 1 free trainer session.",
        active: true,
      },
    }),
    prisma.membershipPlan.create({
      data: {
        organizationId: org.id,
        name: "Half Yearly",
        billingInterval: "HALF_YEARLY",
        priceMinor: inr(6499),
        durationDays: 180,
        description: "6 months full gym access + 2 free trainer sessions.",
        active: true,
      },
    }),
    prisma.membershipPlan.create({
      data: {
        organizationId: org.id,
        name: "Yearly",
        billingInterval: "YEARLY",
        priceMinor: inr(11999),
        durationDays: 365,
        description: "12 months full gym access + 4 free trainer sessions.",
        active: true,
      },
    }),
  ])

  const [monthly, quarterly, halfYearly, yearly] = plans

  // ---------------------------------------------------------------
  // Members
  // ---------------------------------------------------------------
  type MemberSeed = {
    first: string
    last: string
    phone: string
    email?: string
    gender: "MALE" | "FEMALE" | "OTHER"
    plan: (typeof plans)[number]
    startDaysAgo: number
    endDaysFromNow: number
    trainerId?: string
    source?: "WALK_IN" | "WEBSITE" | "FACEBOOK" | "INSTAGRAM" | "GOOGLE"
  }

  const memberSeeds: MemberSeed[] = [
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
    // Expired members (need renewal follow-up)
    { first: "Rakesh", last: "Gupta", phone: "+91 90000 10011", email: "rakesh.gupta@example.com", gender: "MALE", plan: monthly, startDaysAgo: 90, endDaysFromNow: -60, source: "WALK_IN" },
    { first: "Farhan", last: "Khan", phone: "+91 90000 10012", email: "farhan.khan@example.com", gender: "MALE", plan: quarterly, startDaysAgo: 160, endDaysFromNow: -50, trainerId: trainer1.id, source: "GOOGLE" },
    { first: "Kavita", last: "Yadav", phone: "+91 90000 10013", email: "kavita.yadav@example.com", gender: "FEMALE", plan: monthly, startDaysAgo: 60, endDaysFromNow: -30, source: "WALK_IN" },
    { first: "Rohit", last: "Chavan", phone: "+91 90000 10014", email: "rohit.chavan@example.com", gender: "MALE", plan: halfYearly, startDaysAgo: 200, endDaysFromNow: -20, source: "INSTAGRAM" },
    // Inactive members
    { first: "Nikita", last: "Sawant", phone: "+91 90000 10015", email: "nikita.sawant@example.com", gender: "FEMALE", plan: monthly, startDaysAgo: 300, endDaysFromNow: -120, source: "WEBSITE" },
    { first: "Gaurav", last: "Bansal", phone: "+91 90000 10016", email: "gaurav.bansal@example.com", gender: "MALE", plan: monthly, startDaysAgo: 180, endDaysFromNow: -150, source: "FACEBOOK" },
  ]

  const members = []
  for (const s of memberSeeds) {
    const member = await prisma.member.create({
      data: {
        organizationId: org.id,
        primaryLocationId: location.id,
        firstName: s.first,
        lastName: s.last,
        phone: s.phone,
        email: s.email,
        gender: s.gender,
        dateOfBirth: new Date(1988 + Math.floor(Math.random() * 12), Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 27)),
        address: "Flat 42, " + ["MG Road", "FC Road", "Koregaon Park", "Aundh", "Baner"][Math.floor(Math.random() * 5)] + ", Pune",
        emergencyContactName: "Family",
        emergencyContactPhone: "+91 9" + Math.floor(100000000 + Math.random() * 899999999),
        trainerId: s.trainerId,
        signupSource: s.source,
        status: s.endDaysFromNow < -90 ? "INACTIVE" : "ACTIVE",
      },
    })

    const startDate = daysFromNow(-s.startDaysAgo)
    const endDate = daysFromNow(s.endDaysFromNow)
    const membershipStatus =
      s.endDaysFromNow < 0 ? "EXPIRED" : s.endDaysFromNow <= 30 ? "ACTIVE" : "ACTIVE"

    const membership = await prisma.membership.create({
      data: {
        organizationId: org.id,
        memberId: member.id,
        planId: s.plan.id,
        status: membershipStatus,
        startDate,
        endDate,
        amountMinor: s.plan.priceMinor,
        notes: null,
      },
    })

    await prisma.payment.create({
      data: {
        organizationId: org.id,
        memberId: member.id,
        membershipId: membership.id,
        amountMinor: s.plan.priceMinor,
        method: ["CASH", "UPI", "CARD", "BANK_TRANSFER"][Math.floor(Math.random() * 4)] as "CASH" | "UPI" | "CARD" | "BANK_TRANSFER",
        reference: "TXN" + Math.floor(100000000 + Math.random() * 899999999),
        paymentDate: startDate,
        recordedById: [owner.id, admin.id, reception.id][Math.floor(Math.random() * 3)],
        notes: `Initial payment — ${s.plan.name} plan`,
      },
    })

    members.push(member)
  }

  // ---------------------------------------------------------------
  // Attendance (today + trailing days for active members)
  // ---------------------------------------------------------------
  const activeMembers = memberSeeds.filter((s) => s.endDaysFromNow > 0)

  const todayKey = dayKey(now)
  for (let i = 0; i < activeMembers.length; i++) {
    // Every active member checked in at least once this week; most today
    const checkinToday = i % 3 !== 2
    if (checkinToday) {
      await prisma.checkIn.create({
        data: {
          organizationId: org.id,
          memberId: members[i].id,
          locationId: location.id,
          source: "MANUAL",
          dayKey: todayKey,
          checkedInAt: new Date(now.getTime() - i * 37 * 60 * 1000),
        },
      })
    }
    // trailing 14 days of history
    for (let d = 1; d <= 14; d++) {
      if ((i + d) % 3 !== 0) {
        const day = new Date(now.getTime() - d * DAY)
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

  // ---------------------------------------------------------------
  // Leads + activities
  // ---------------------------------------------------------------
  type LeadSeed = {
    name: string
    phone: string
    email?: string
    source: "WEBSITE" | "INSTAGRAM" | "FACEBOOK" | "WHATSAPP" | "GOOGLE" | "WALK_IN" | "MANUAL"
    stage: "NEW" | "CONTACTED" | "VISIT_SCHEDULED" | "VISIT_DONE" | "CONVERTED" | "LOST"
    followUpInDays?: number
    plan?: (typeof plans)[number]
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
    // Converted lead — connected to an active member (Sneha Iyer)
    { name: "Sneha Iyer", phone: "+91 90000 10002", email: "sneha.iyer@example.com", source: "INSTAGRAM", stage: "CONVERTED", plan: yearly, ownerId: reception.id },
  ]

  const leadIds: string[] = []
  for (const s of leadSeeds) {
    let convertedMemberId: string | undefined = undefined
    let convertedAt: Date | null = null
    if (s.stage === "CONVERTED") {
      const existingMember = await prisma.member.findFirst({ where: { organizationId: org.id, email: s.email } })
      if (existingMember) {
        convertedMemberId = existingMember.id
        convertedAt = daysFromNow(-60)
      }
    }
    const lead = await prisma.lead.create({
      data: {
        organizationId: org.id,
        locationId: location.id,
        name: s.name,
        phone: s.phone,
        email: s.email,
        source: s.source,
        stage: s.stage,
        interestedPlanId: s.plan?.id,
        ownerUserId: s.ownerId,
        followUpDate: s.followUpInDays !== undefined ? daysFromNow(s.followUpInDays) : null,
        notes: s.source === "WALK_IN" ? "Walked in during evening rush, seemed very interested." : null,
        convertedMemberId,
        convertedAt,
      },
    })
    leadIds.push(lead.id)

    const activityTypeForStage = (stage: LeadSeed["stage"]) => {
      if (stage === "CONVERTED") return "NOTE" as const
      if (stage === "VISIT_DONE") return "VISIT" as const
      if (stage === "VISIT_SCHEDULED") return "CALL" as const
      if (stage === "CONTACTED") return "CALL" as const
      return "NOTE" as const
    }
    await prisma.leadActivity.create({
      data: {
        organizationId: org.id,
        leadId: lead.id,
        type: activityTypeForStage(s.stage),
        body: `Lead created from ${s.source}. ${s.followUpInDays === 0 ? "Follow-up due today." : ""}`.trim(),
        createdById: reception.id,
        activityDate: daysFromNow(-1),
      },
    })
  }

  // ---------------------------------------------------------------
  // Appointments (today + upcoming)
  // ---------------------------------------------------------------
  const memberA = members[0]
  const memberB = members[5]
  const memberC = members[7]

  await prisma.appointment.createMany({
    data: [
      {
        organizationId: org.id,
        locationId: location.id,
        memberId: memberA.id,
        leadId: null,
        trainerId: trainer1.id,
        staffId: trainerUser1.id,
        startsAt: hoursFromNow(1),
        endsAt: hoursFromNow(2),
        status: "SCHEDULED",
        notes: "Strength assessment",
      },
      {
        organizationId: org.id,
        locationId: location.id,
        memberId: memberB.id,
        leadId: null,
        trainerId: trainer2.id,
        staffId: trainerUser2.id,
        startsAt: hoursFromNow(4),
        endsAt: hoursFromNow(5),
        status: "SCHEDULED",
        notes: "Functional training session",
      },
      {
        organizationId: org.id,
        locationId: location.id,
        memberId: memberC.id,
        leadId: null,
        trainerId: trainer2.id,
        staffId: trainerUser2.id,
        startsAt: hoursFromNow(28),
        endsAt: hoursFromNow(29),
        status: "SCHEDULED",
        notes: "Yoga alignment review",
      },
      {
        organizationId: org.id,
        locationId: location.id,
        memberId: null,
        leadId: leadIds[2],
        trainerId: trainer1.id,
        staffId: trainerUser1.id,
        startsAt: hoursFromNow(3),
        endsAt: hoursFromNow(3.5),
        status: "SCHEDULED",
        notes: "Gym tour + plan discussion",
      },
      {
        organizationId: org.id,
        locationId: location.id,
        memberId: null,
        leadId: leadIds[3],
        trainerId: null,
        staffId: admin.id,
        startsAt: hoursFromNow(-2),
        endsAt: hoursFromNow(-1),
        status: "COMPLETED",
        notes: "Intro visit completed",
      },
    ],
  })

  // ---------------------------------------------------------------
  // Tasks / follow-ups
  // ---------------------------------------------------------------
  await prisma.task.createMany({
    data: [
      {
        organizationId: org.id,
        title: "Call Aditya Ranade — new website lead",
        description: "Introduce membership plans and schedule a visit.",
        dueDate: daysFromNow(0),
        status: "TODO",
        assigneeId: reception.id,
        createdById: admin.id,
        leadId: leadIds[0],
      },
      {
        organizationId: org.id,
        title: "Follow up with Sneha Iyer — membership expires soon",
        description: "Sneha's yearly membership expires in 60 days. Propose renewal or upgrade.",
        dueDate: daysFromNow(0),
        status: "TODO",
        assigneeId: reception.id,
        createdById: admin.id,
        memberId: members[1].id,
      },
      {
        organizationId: org.id,
        title: "Call Rakesh Gupta — expired 60 days ago",
        description: "Re-engage lapsed member with a comeback offer.",
        dueDate: daysFromNow(-2),
        status: "TODO",
        assigneeId: reception.id,
        createdById: admin.id,
        memberId: members[10].id,
      },
      {
        organizationId: org.id,
        title: "Renewal reminder — Farhan Khan",
        description: "Quarterly plan expired. Share renewal discount.",
        dueDate: daysFromNow(-1),
        status: "IN_PROGRESS",
        assigneeId: reception.id,
        createdById: admin.id,
        memberId: members[11].id,
      },
      {
        organizationId: org.id,
        title: "Confirm tomorrow's PT slot for Pooja Nair",
        description: "Verify appointment with trainer Neha.",
        dueDate: daysFromNow(1),
        status: "TODO",
        assigneeId: reception.id,
        createdById: admin.id,
        memberId: members[3].id,
      },
      {
        organizationId: org.id,
        title: "Call Diya Iyer — facebook lead follow-up",
        description: "Last contact 3 days ago; nurture pipeline.",
        dueDate: daysFromNow(1),
        status: "TODO",
        assigneeId: reception.id,
        createdById: admin.id,
        leadId: leadIds[5],
      },
    ],
  })

  // ---------------------------------------------------------------
  // An active QR session for demoing QR attendance
  // ---------------------------------------------------------------
  const demoQrToken = randomBytes(24).toString("hex")
  const demoQrHash = createHash("sha256").update(demoQrToken).digest("hex")
  await prisma.qRSession.create({
    data: {
      organizationId: org.id,
      locationId: location.id,
      label: "Front desk — active demo session",
      tokenHash: demoQrHash,
      expiresAt: hoursFromNow(8),
      createdById: admin.id,
    },
  })
  console.log("Active QR token (dev demo):")
  console.log(`  ${demoQrToken}`)

  // ---------------------------------------------------------------
  // Notifications (a mix of read/unread)
  // ---------------------------------------------------------------
  await prisma.notification.createMany({
    data: [
      {
        organizationId: org.id,
        userId: owner.id,
        type: "MEMBERSHIP_EXPIRING",
        title: "3 memberships expiring this week",
        body: "Ananya Joshi, Karan Mehta and Arjun Patel expire within 7 days.",
        link: "/dashboard/members?filter=expiring",
        isRead: false,
        createdAt: daysFromNow(-1),
      },
      {
        organizationId: org.id,
        userId: owner.id,
        type: "NEW_LEAD",
        title: "New lead: Aditya Ranade",
        body: "Website lead is waiting for a follow-up.",
        link: "/dashboard/leads",
        isRead: false,
        createdAt: hoursFromNow(-3),
      },
      {
        organizationId: org.id,
        userId: owner.id,
        type: "PAYMENT_RECORDED",
        title: "Payment received: ₹1,299",
        body: "Monthly membership payment recorded today.",
        link: "/dashboard/payments",
        isRead: false,
        createdAt: hoursFromNow(-5),
      },
      {
        organizationId: org.id,
        userId: owner.id,
        type: "TASK_OVERDUE",
        title: "Overdue: Call Rakesh Gupta",
        body: "Re-engagement call is 2 days overdue.",
        link: "/dashboard/tasks",
        isRead: true,
        createdAt: daysFromNow(-2),
      },
      {
        organizationId: org.id,
        userId: admin.id,
        type: "NEW_LEAD",
        title: "New lead: Ritika Jain",
        body: "Facebook lead assigned to front desk.",
        link: "/dashboard/leads",
        isRead: false,
        createdAt: hoursFromNow(-6),
      },
      {
        organizationId: org.id,
        userId: reception.id,
        type: "TASK_ASSIGNED",
        title: "Task assigned: Call Aditya Ranade",
        body: "Follow-up on new website lead.",
        link: "/dashboard/tasks",
        isRead: false,
        createdAt: hoursFromNow(-2),
      },
    ],
  })

  // ---------------------------------------------------------------
  // Audit log samples
  // ---------------------------------------------------------------
  await prisma.auditLog.createMany({
    data: [
      {
        organizationId: org.id,
        actorUserId: admin.id,
        action: "member.created",
        entityType: "Member",
        entityId: members[0].id,
        after: { firstName: members[0].firstName } as unknown as object,
        createdAt: daysFromNow(-20),
      },
      {
        organizationId: org.id,
        actorUserId: admin.id,
        action: "payment.recorded",
        entityType: "Payment",
        entityId: null,
        after: { amountMinor: 349900, method: "UPI" } as unknown as object,
        createdAt: daysFromNow(-2),
      },
      {
        organizationId: org.id,
        actorUserId: admin.id,
        action: "lead.converted",
        entityType: "Lead",
        entityId: null,
        after: { memberCreated: true } as unknown as object,
        createdAt: daysFromNow(-60),
      },
    ],
  })

  console.log("Seed complete.")
  console.log("")
  console.log("Demo login (local dev only):")
  console.log("  owner@kingsgym.in / Kings@123")
  console.log("  admin@kingsgym.in / Kings@123")
  console.log("  frontdesk@kingsgym.in / Kings@123")
  console.log("  vikram@kingsgym.in / Kings@123")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })