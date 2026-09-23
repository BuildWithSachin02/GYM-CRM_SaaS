import { test } from "node:test"
import assert from "node:assert/strict"

import {
  buildModuleIndexRows,
  buildSummaryRows,
  dateKeyInZone,
  dateCellFromKey,
  datetimeInZone,
  dateTimeCellInZone,
  exportWorkbookFilename,
  EXPORT_COLUMNS,
  FINANCIAL_SUMMARY_COLUMNS,
  mapExportRow,
  mapFinancialSummaryRow,
  MODULE_DESCRIPTIONS,
  type DateCell,
  type ExcelCell,
  type ExportRowMap,
  type SummaryCounts,
} from "../src/lib/data-export-mapping"
import { DATA_CATEGORY_ORDER, EXPORT_SHEET_ORDER } from "../src/lib/data-catalog"

const TZ = "Asia/Kolkata"

const ISO_DAY = "2026-09-21T18:30:00.000Z"

function hoursAt(h: number) {
  return `2026-09-21T${String(h).padStart(2, "0")}:00:00.000Z`
}

const dateCell = (v: unknown): Date => {
  assert.ok(typeof v === "object" && v !== null && "kind" in v, "expected a date cell")
  return (v as DateCell).value
}

const kindOf = (v: ExcelCell): string =>
  typeof v === "object" && v !== null && "kind" in v ? (v as DateCell).kind : typeof v

// ---------------------------------------------------------------------------
// Time formatting (org-timezone, shift-proof)
// ---------------------------------------------------------------------------

test("datetimeInZone renders the instant in the org timezone", () => {
  // 18:30 UTC == 00:00 IST next day
  assert.equal(datetimeInZone(ISO_DAY, TZ), "2026-09-22 00:00:00")
  assert.equal(datetimeInZone(hoursAt(12), TZ), "2026-09-21 17:30:00")
  assert.equal(datetimeInZone(null, TZ), "")
})

test("dateKeyInZone renders the org-local calendar day", () => {
  assert.equal(dateKeyInZone(hoursAt(12), TZ), "2026-09-21")
  assert.equal(dateKeyInZone(hoursAt(23), TZ), "2026-09-22")
})

test("date cell values are Excel-ready day/datetimes in the org clock", () => {
  // 23:00 UTC previous day == 04:30 IST on 2026-09-22
  const dt = dateCell(dateTimeCellInZone("2026-09-21T23:00:00.000Z", TZ))
  assert.equal(dt.toISOString(), "2026-09-22T04:30:00.000Z")
  assert.equal(dateCell(dateCellFromKey("2026-09-21")).toISOString(), "2026-09-21T00:00:00.000Z")
})

// ---------------------------------------------------------------------------
// Headers + row mapping length parity
// ---------------------------------------------------------------------------

test("every export sheet defines non-empty, unique columns", () => {
  assert.deepEqual([...EXPORT_SHEET_ORDER].sort(), [...DATA_CATEGORY_ORDER].sort())
  for (const key of EXPORT_SHEET_ORDER) {
    const cols = EXPORT_COLUMNS[key]
    assert.ok(cols.length > 0, `${key} should define columns`)
    assert.equal(new Set(cols.map((c) => c.header)).size, cols.length, `${key} headers unique`)
  }
  assert.ok(FINANCIAL_SUMMARY_COLUMNS.length > 0)
})

test("members row maps one cell per header and redacts secrets", () => {
  const row: ExportRowMap["members"] = {
    id: "mem-1",
    firstName: "Aarav",
    lastName: "Sharma",
    phone: "+91 90000 00000",
    email: "aarav@example.com",
    gender: "MALE",
    dateOfBirth: new Date(hoursAt(5)),
    address: "Bengaluru",
    emergencyContactName: null,
    emergencyContactPhone: null,
    signupSource: "WALK_IN",
    status: "ACTIVE",
    notes: null,
    deletedAt: null,
    createdAt: new Date(hoursAt(10)),
    updatedAt: new Date(hoursAt(11)),
    trainer: { user: { name: "Ravi Verma" } },
    location: { name: "King's Gym" },
  }
  const cells = mapExportRow("members", row, TZ)
  assert.equal(cells.length, EXPORT_COLUMNS.members.length)
  assert.equal(cells[0], "mem-1")
  assert.equal(cells[3], "Aarav Sharma")
  assert.equal(cells[14], "ACTIVE")
  assert.equal(dateCell(cells[7]).toISOString(), "2026-09-21T00:00:00.000Z") // DoB local day
  assert.equal(cells[11], "Ravi Verma")
  assert.equal(kindOf(cells[17]), "datetime")
})

test("memberships row renders money as a decimal, duration, and joins names", () => {
  const row: ExportRowMap["memberships"] = {
    id: "ms-1",
    memberId: "mem-1",
    planId: "plan-1",
    status: "ACTIVE",
    startDate: new Date("2026-09-01T00:00:00.000Z"),
    endDate: new Date("2026-09-30T00:00:00.000Z"),
    amountMinor: 200000,
    renewsAutomatically: true,
    expectedPaymentDate: null,
    notes: null,
    createdAt: new Date(hoursAt(9)),
    updatedAt: new Date(hoursAt(9)),
    member: { firstName: "Aarav", lastName: "Sharma", phone: null },
    plan: { name: "Annual Gold", priceMinor: 250000 },
    _finance: { paidMinor: 50000, outstandingMinor: 150000, expectedPaymentKey: "2026-09-25", status: "PENDING" },
  }
  const cells = mapExportRow("memberships", row, TZ)
  assert.equal(cells.length, EXPORT_COLUMNS.memberships.length)
  assert.equal(cells[2], "Aarav Sharma")
  assert.equal(cells[4], "Annual Gold")
  assert.equal(cells[5], 2500) // plan price ₹2,500 (comparison field, not revenue)
  assert.equal(cells[8], 29) // inclusive period length in calendar days
  assert.equal(cells[10], 2000) // 200000 paise → 2000.00 charged amount
  // Service-enriched balance columns: RECORDED-paid vs remaining (never revenue).
  assert.equal(cells[11], 500) // ₹500 paid so far
  assert.equal(cells[12], 1500) // ₹1,500 outstanding
  assert.equal(dateCell(cells[13]).toISOString(), "2026-09-25T00:00:00.000Z") // expected date local day
  assert.equal(cells[14], "PENDING")
  assert.equal(cells[15], "Yes")
  assert.equal(dateCell(cells[6]).toISOString(), "2026-09-01T00:00:00.000Z")
})

test("payments row carries plan context, method, status and money (per-transaction)", () => {
  const row: ExportRowMap["payments"] = {
    id: "pay-1",
    memberId: "mem-1",
    membershipId: "ms-1",
    amountMinor: 50000,
    currency: "INR",
    paymentDate: new Date(hoursAt(12)),
    method: "UPI",
    status: "RECORDED",
    reference: "TXN-9001",
    notes: "Initial payment",
    createdAt: new Date(hoursAt(12)),
    updatedAt: new Date(hoursAt(13)),
    member: { firstName: "Aarav", lastName: "Sharma" },
    membership: {
      id: "ms-1",
      status: "ACTIVE",
      startDate: new Date("2026-09-01T00:00:00.000Z"),
      endDate: new Date("2026-09-30T00:00:00.000Z"),
      plan: { id: "plan-1", name: "Annual Gold" },
    },
    recordedBy: { name: "Receptionist" },
  }
  const cells = mapExportRow("payments", row, TZ)
  assert.equal(cells.length, EXPORT_COLUMNS.payments.length)
  assert.equal(cells[9], "Annual Gold")
  assert.equal(cells[10], "plan-1")
  assert.equal(cells[4], 500) // 50000 paise → 500.00
  assert.equal(kindOf(cells[4]), "number")
  assert.equal(cells[6], "UPI")
  assert.equal(cells[7], "RECORDED")
  assert.equal(dateCell(cells[11]).toISOString(), "2026-09-01T00:00:00.000Z")
  assert.equal(cells[13], "TXN-9001")
  assert.equal(cells[15], "Receptionist")
})

test("payments row keeps an unlinked membership empty-safe", () => {
  const row: ExportRowMap["payments"] = {
    id: "pay-x",
    memberId: "mem-1",
    membershipId: null,
    amountMinor: 10000,
    currency: "INR",
    paymentDate: new Date(hoursAt(12)),
    method: "CASH",
    status: "RECORDED",
    reference: null,
    notes: null,
    createdAt: new Date(hoursAt(12)),
    updatedAt: new Date(hoursAt(12)),
    member: { firstName: "Aarav", lastName: "Sharma" },
    membership: null,
    recordedBy: { name: "Owner" },
  }
  const cells = mapExportRow("payments", row, TZ)
  assert.equal(cells[9], "")
  assert.equal(cells[10], "")
  assert.equal(cells[11], "")
})

test("attendance row keeps the org-local dayKey, source and optional QR label", () => {
  const row: ExportRowMap["attendance"] = {
    id: "ck-1",
    memberId: "mem-1",
    dayKey: "2026-09-21",
    checkedInAt: new Date(hoursAt(23)),
    source: "QR_SESSION",
    member: { firstName: "Aarav", lastName: "Sharma" },
    location: null,
    qrSession: { id: "qr-9", label: "Main desk" },
  }
  const cells = mapExportRow("attendance", row, TZ)
  assert.equal(cells.length, EXPORT_COLUMNS.attendance.length)
  assert.equal(dateCell(cells[3]).toISOString(), "2026-09-21T00:00:00.000Z")
  assert.equal(dateCell(cells[4]).toISOString(), "2026-09-22T04:30:00.000Z") // 23:00 UTC → 04:30 IST
  assert.equal(cells[5], "")
  assert.equal(cells[6], "QR_SESSION")
  assert.equal(cells[7], "Main desk")
  assert.equal(cells[8], "qr-9")
})

test("leads row maps owner, plan, conversion and timestamps", () => {
  const row: ExportRowMap["leads"] = {
    id: "lead-1",
    name: "Neha Gupta",
    phone: "+91 97777 77777",
    email: "neha@example.com",
    source: "INSTAGRAM",
    sourceDetail: "Reel",
    stage: "CONVERTED",
    followUpDate: new Date(hoursAt(10)),
    convertedAt: new Date(hoursAt(5)),
    convertedMemberId: "mem-12",
    notes: null,
    deletedAt: null,
    createdAt: new Date(hoursAt(6)),
    updatedAt: new Date(hoursAt(6)),
    location: { name: "King's Gym" },
    interestedPlan: { name: "Monthly Silver" },
    ownerUser: { name: "Ravi Verma" },
    convertedMember: { firstName: "Ananya", lastName: "Joshi" },
  }
  const cells = mapExportRow("leads", row, TZ)
  assert.equal(cells.length, EXPORT_COLUMNS.leads.length)
  assert.equal(cells[7], "Monthly Silver")
  assert.equal(cells[8], "Ravi Verma")
  assert.equal(cells[11], "mem-12")
  assert.equal(cells[12], "Ananya Joshi")
  assert.equal(dateCell(cells[16]).toISOString(), "2026-09-21T11:30:00.000Z")
})

test("appointments and tasks keep optional participants empty-safe", () => {
  const appointment: ExportRowMap["appointments"] = {
    id: "apt-1",
    startsAt: new Date(hoursAt(8)),
    endsAt: new Date(hoursAt(9)),
    status: "SCHEDULED",
    notes: null,
    createdAt: new Date(hoursAt(8)),
    updatedAt: new Date(hoursAt(9)),
    member: null,
    lead: { id: "lead-2", name: "Neha Gupta" },
    trainer: null,
    staff: null,
    location: { name: "Main floor" },
  }
  const aptCells = mapExportRow("appointments", appointment, TZ)
  assert.equal(aptCells.length, EXPORT_COLUMNS.appointments.length)
  assert.equal(aptCells[1], "")
  assert.equal(aptCells[3], "lead-2")
  assert.equal(aptCells[4], "Neha Gupta")
  assert.equal(aptCells[10], "Main floor")

  const task: ExportRowMap["tasks"] = {
    id: "task-1",
    title: "Call Neha",
    description: null,
    dueDate: new Date(hoursAt(12)),
    status: "TODO",
    createdAt: new Date(hoursAt(12)),
    updatedAt: new Date(hoursAt(12)),
    assignee: null,
    createdBy: null,
    member: { id: "mem-1", firstName: "Aarav", lastName: "Sharma" },
    lead: null,
  }
  const taskCells = mapExportRow("tasks", task, TZ)
  assert.equal(taskCells.length, EXPORT_COLUMNS.tasks.length)
  assert.equal(taskCells[1], "Call Neha")
  assert.equal(taskCells[7], "mem-1")
  assert.equal(taskCells[8], "Aarav Sharma")
})

test("QR session and lead activity rows map cleanly", () => {
  const qr: ExportRowMap["qrSessions"] = {
    id: "qr-1",
    label: "Front desk",
    expiresAt: new Date(hoursAt(20)),
    revokedAt: null,
    createdAt: new Date(hoursAt(20)),
    location: { name: "King's Gym" },
    createdBy: { name: "Ravi Verma" },
  }
  const qrCells = mapExportRow("qrSessions", qr, TZ)
  assert.equal(qrCells.length, EXPORT_COLUMNS.qrSessions.length)
  assert.equal(qrCells[1], "Front desk")
  assert.equal(qrCells[5], "Ravi Verma")

  const activity: ExportRowMap["leadActivities"] = {
    id: "act-1",
    type: "CALL",
    body: "Discussed plans",
    activityDate: new Date(hoursAt(11)),
    createdAt: new Date(hoursAt(11)),
    lead: { id: "lead-2", name: "Neha Gupta" },
    createdBy: null,
  }
  const actCells = mapExportRow("leadActivities", activity, TZ)
  assert.equal(actCells.length, EXPORT_COLUMNS.leadActivities.length)
  assert.equal(actCells[1], "lead-2")
  assert.equal(actCells[2], "Neha Gupta")
  assert.equal(actCells[3], "CALL")
})

test("trainers row maps only safe staff fields — never credentials", () => {
  const row: ExportRowMap["trainers"] = {
    id: "tr-1",
    user: { name: "Ravi Verma", email: "ravi@kingsgym.in", phone: "+91 95555 55555", role: "TRAINER", status: "ACTIVE" },
    bio: "Strength & conditioning coach",
    specialties: ["STRENGTH", "CROSSFIT"],
    active: true,
    createdAt: new Date(hoursAt(9)),
    updatedAt: new Date(hoursAt(10)),
    _count: { members: 7 },
  }
  const cells = mapExportRow("trainers", row, TZ)
  assert.equal(cells.length, EXPORT_COLUMNS.trainers.length)
  assert.equal(cells[0], "tr-1")
  assert.equal(cells[1], "Ravi Verma")
  assert.equal(cells[2], "ravi@kingsgym.in")
  assert.equal(cells[7], JSON.stringify(["STRENGTH", "CROSSFIT"]))
  assert.equal(cells[8], "Yes")
  assert.equal(cells[9], 7)
  assert.equal(kindOf(cells[10]), "datetime")
  const headers = EXPORT_COLUMNS.trainers.map((c) => c.header.toLowerCase())
  assert.ok(!headers.join(" ").includes("password"))
  assert.ok(!headers.join(" ").includes("token"))
})

test("plans row maps price and billing", () => {
  const row: ExportRowMap["plans"] = {
    id: "plan-1",
    name: "Annual Gold",
    billingInterval: "YEARLY",
    priceMinor: 200000,
    currency: "INR",
    durationDays: 365,
    description: "Full access",
    active: true,
    createdAt: new Date(hoursAt(9)),
    updatedAt: new Date(hoursAt(10)),
  }
  const cells = mapExportRow("plans", row, TZ)
  assert.equal(cells.length, EXPORT_COLUMNS.plans.length)
  assert.equal(cells[1], "Annual Gold")
  assert.equal(cells[3], 2000)
  assert.equal(cells[7], "Yes")
  assert.equal(kindOf(cells[9]), "datetime")
})

// ---------------------------------------------------------------------------
// Member Financial Summary mapping
// ---------------------------------------------------------------------------

test("financial summary row maps aggregated values with money conversion", () => {
  const cells = mapFinancialSummaryRow(
    {
      memberId: "mem-1",
      memberName: "Aarav Sharma",
      currentPlan: "Annual Gold",
      currentStatus: "ACTIVE",
      currentStartKey: "2026-09-01",
      currentEndKey: "2026-09-30",
      totalMembershipValueMinor: 1000000,
      totalPaidMinor: 1000000,
      paymentCount: 3,
      latestPaymentMinor: 300000,
      latestPaymentKey: "2026-09-18",
      methods: ["UPI", "CASH"],
    }
  )
  assert.equal(cells.length, FINANCIAL_SUMMARY_COLUMNS.length)
  assert.equal(cells[0], "mem-1")
  assert.equal(cells[2], "Annual Gold")
  assert.equal(cells[3], "ACTIVE")
  assert.equal(cells[6], 10000) // 1,000,000 paise → ₹10,000
  assert.equal(cells[7], 10000)
  assert.equal(cells[8], 3)
  assert.equal(cells[9], 3000) // latest payment ₹3,000
  assert.equal(cells[10] && typeof cells[10] === "object" ? dateCell(cells[10]).toISOString() : "", "2026-09-18T00:00:00.000Z")
  assert.equal(cells[11], "UPI, CASH")
})

// ---------------------------------------------------------------------------
// Summary rows
// ---------------------------------------------------------------------------

test("summary rows report recorded-only collected amount and totals", () => {
  const counts: SummaryCounts = {
    members: { active: 10, inactive: 2, archived: 1 },
    memberships: { active: 8, expired: 3, cancelled: 1, paused: 1 },
    payments: { recorded: 12, voided: 2, refunded: 1 },
    collectedMinor: 1540000, // ₹15,400
    plans: 4,
    attendance: 55,
    leads: 9,
    convertedLeads: 2,
    appointments: 5,
    tasks: 8,
    qrSessions: 2,
    leadActivities: 11,
    trainers: 3,
  }
  const rows = buildSummaryRows({
    gymName: "King's Gym",
    timeZone: TZ,
    generatedAt: new Date(hoursAt(12)),
    rangeLabel: "2026-09-01 — 2026-09-30",
    counts,
  })
  const row = (metric: string) => rows.find((r) => r.metric === metric)
  assert.equal(row("Members")?.value, 13)
  assert.equal(row("Amount collected (INR)")?.value, 15400)
  assert.equal(row("Amount collected (INR)")?.money, true)
  assert.equal(row("Payment transactions")?.value, 15)
  assert.equal(row("Date range")?.value, "2026-09-01 — 2026-09-30")
  // Membership prices must never inflate collected revenue.
  assert.equal(rows.filter((r) => r.metric === "Amount collected (INR)").length, 1)
})

test("summary rows report only the selected modules", () => {
  const counts: SummaryCounts = {
    members: { active: 10, inactive: 2, archived: 1 },
    memberships: { active: 8, expired: 3, cancelled: 1, paused: 1 },
    payments: { recorded: 12, voided: 2, refunded: 1 },
    collectedMinor: 1540000,
    plans: 4,
    attendance: 55,
    leads: 9,
    convertedLeads: 2,
    appointments: 5,
    tasks: 8,
    qrSessions: 2,
    leadActivities: 11,
    trainers: 3,
  }
  const rows = buildSummaryRows({
    gymName: "King's Gym",
    timeZone: TZ,
    generatedAt: new Date(hoursAt(12)),
    rangeLabel: "2026-09-01 — 2026-09-30",
    counts,
    selectedCategories: ["members", "payments"],
  })
  const metrics = rows.map((r) => r.metric)
  assert.ok(metrics.includes("Members"))
  assert.ok(metrics.includes("  Active members"))
  assert.ok(metrics.includes("Payment transactions"))
  assert.ok(metrics.includes("Amount collected (INR)"))
  assert.ok(!metrics.includes("Memberships"))
  assert.ok(!metrics.includes("Attendance check-ins"))
  assert.ok(!metrics.includes("Leads"))
  assert.ok(!metrics.includes("Tasks"))
  assert.ok(!metrics.includes("QR sessions"))
})

test("summary rows: includeHeader: false drops the export-information block (Business Overview)", () => {
  const counts: SummaryCounts = {
    members: { active: 10, inactive: 2, archived: 1 },
    memberships: { active: 8, expired: 3, cancelled: 1, paused: 1 },
    payments: { recorded: 12, voided: 2, refunded: 1 },
    collectedMinor: 1540000,
    plans: 4,
    attendance: 55,
    leads: 9,
    convertedLeads: 2,
    appointments: 5,
    tasks: 8,
    qrSessions: 2,
    leadActivities: 11,
    trainers: 3,
  }
  const rows = buildSummaryRows({
    gymName: "King's Gym",
    timeZone: TZ,
    generatedAt: new Date(hoursAt(12)),
    rangeLabel: "All Time",
    counts,
    includeHeader: false,
  })
  const metrics = rows.map((r) => r.metric)
  assert.ok(!metrics.includes("Gym"))
  assert.ok(!metrics.includes("Date range"))
  assert.ok(!metrics.includes("Timezone"))
  assert.ok(!metrics.includes("Export generated at"))
  assert.ok(metrics.includes("Members"))
  assert.ok(metrics.includes("Trainers"))
})

test("summary rows: trainers is reported when the module is selected", () => {
  const counts: SummaryCounts = {
    members: { active: 0, inactive: 0, archived: 0 },
    memberships: { active: 0, expired: 0, cancelled: 0, paused: 0 },
    payments: { recorded: 0, voided: 0, refunded: 0 },
    collectedMinor: 0,
    plans: 0,
    attendance: 0,
    leads: 0,
    convertedLeads: 0,
    appointments: 0,
    tasks: 0,
    qrSessions: 0,
    leadActivities: 0,
    trainers: 4,
  }
  const rows = buildSummaryRows({
    gymName: "King's Gym",
    timeZone: TZ,
    generatedAt: new Date(hoursAt(12)),
    rangeLabel: "All Time",
    counts,
    selectedCategories: ["trainers"],
  })
  assert.equal(rows.find((r) => r.metric === "Trainers")?.value, 4)
})

// ---------------------------------------------------------------------------
// Clickable module index
// ---------------------------------------------------------------------------

test("module index rows pair keys with their sheet counts and descriptions", () => {
  const items = buildModuleIndexRows(
    ["members", "payments", "trainers"],
    [27, 35, 3]
  )
  assert.equal(items.length, 3)
  assert.deepEqual(items[0], {
    sheetName: "Members",
    label: "Members",
    count: 27,
    description: MODULE_DESCRIPTIONS.members,
  })
  assert.equal(items[1].sheetName, "Payments")
  assert.equal(items[1].count, 35)
  assert.equal(items[2].sheetName, "Trainers")
  assert.equal(items[2].count, 3)
  const titles = items.map((i) => i.sheetName)
  assert.equal(new Set(titles).size, titles.length)
})

// ---------------------------------------------------------------------------
// Workbook filename
// ---------------------------------------------------------------------------

test("exportWorkbookFilename uses a sanitized gym name and org-local date", () => {
  const name = exportWorkbookFilename('"King\'s Gym / Demo"', TZ, new Date(hoursAt(23)))
  assert.match(name, /^GymCRM-Export-.+-2026-09-22\.xlsx$/)
  assert.ok(!name.includes("/"))
  assert.ok(!name.includes('"'))
})

test("exportWorkbookFilename falls back for unnamed gyms", () => {
  const name = exportWorkbookFilename("", TZ, new Date(hoursAt(23)))
  assert.match(name, /^GymCRM-Export-Gym-2026-09-22\.xlsx$/)
})