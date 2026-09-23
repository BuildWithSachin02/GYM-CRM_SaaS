import { test } from "node:test"
import assert from "node:assert/strict"
import ExcelJS from "exceljs"

import { EXPORT_SHEET_ORDER } from "../src/lib/data-catalog"
import type { ExportRowMap, SummaryCounts } from "../src/lib/data-export-mapping"
import type { MemberFinancialSummaryRow } from "../src/lib/data-financials"
import { buildWorkbookFile, type WorkbookBuildInput, type WorkbookSheetData } from "../src/lib/workbook-builder"

const TZ = "Asia/Kolkata"
const NOW = new Date("2026-09-21T06:00:00.000Z")

function counts(): SummaryCounts {
  return {
    members: { active: 2, inactive: 0, archived: 0 },
    memberships: { active: 2, expired: 0, cancelled: 0, paused: 0 },
    payments: { recorded: 2, voided: 1, refunded: 0 },
    collectedMinor: 70000, // ₹700 of recorded-only revenue
    plans: 1,
    attendance: 5,
    leads: 2,
    convertedLeads: 1,
    appointments: 1,
    tasks: 1,
    qrSessions: 1,
    leadActivities: 2,
    trainers: 1,
  }
}

function memberRow(id: string): ExportRowMap["members"] {
  return {
    id,
    firstName: "Aarav",
    lastName: "Sharma",
    phone: "+91 90000 00000",
    email: null,
    gender: "MALE",
    dateOfBirth: null,
    address: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    signupSource: "WALK_IN",
    status: "ACTIVE",
    notes: null,
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    trainer: null,
    location: { name: "King's Gym" },
  }
}

function membershipRow(id: string, amountMinor: number, priceMinor: number): ExportRowMap["memberships"] {
  return {
    id,
    memberId: "mem-1",
    planId: "plan-1",
    status: "ACTIVE",
    startDate: new Date("2026-09-01T00:00:00.000Z"),
    endDate: new Date("2026-09-30T00:00:00.000Z"),
    amountMinor,
    renewsAutomatically: false,
    expectedPaymentDate: null,
    notes: null,
    createdAt: NOW,
    updatedAt: NOW,
    member: { firstName: "Aarav", lastName: "Sharma", phone: null },
    plan: { name: "Annual Gold", priceMinor },
  }
}

function paymentRow(id: string, status: string, amountMinor: number): ExportRowMap["payments"] {
  return {
    id,
    memberId: "mem-1",
    membershipId: "ms-1",
    amountMinor,
    currency: "INR",
    paymentDate: NOW,
    method: "UPI",
    status,
    reference: null,
    notes: null,
    createdAt: NOW,
    updatedAt: NOW,
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
}

function attendanceRow(id: string): ExportRowMap["attendance"] {
  return {
    id,
    memberId: "mem-1",
    dayKey: "2026-09-21",
    checkedInAt: NOW,
    source: "MANUAL",
    member: { firstName: "Aarav", lastName: "Sharma" },
    location: null,
    qrSession: null,
  }
}

function leadRow(id: string): ExportRowMap["leads"] {
  return {
    id,
    name: "Neha Gupta",
    phone: "+91 97777 77777",
    email: null,
    source: "INSTAGRAM",
    sourceDetail: null,
    stage: "NEW",
    followUpDate: null,
    convertedAt: null,
    convertedMemberId: null,
    notes: null,
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    location: null,
    interestedPlan: null,
    ownerUser: null,
    convertedMember: null,
  }
}

function appointmentRow(id: string): ExportRowMap["appointments"] {
  return {
    id,
    startsAt: new Date("2026-09-22T08:00:00.000Z"),
    endsAt: new Date("2026-09-22T09:00:00.000Z"),
    status: "SCHEDULED",
    notes: null,
    createdAt: NOW,
    updatedAt: NOW,
    member: { id: "mem-1", firstName: "Aarav", lastName: "Sharma" },
    lead: null,
    trainer: null,
    staff: null,
    location: null,
  }
}

function taskRow(id: string): ExportRowMap["tasks"] {
  return {
    id,
    title: "Call Neha",
    description: null,
    dueDate: NOW,
    status: "TODO",
    createdAt: NOW,
    updatedAt: NOW,
    assignee: null,
    createdBy: null,
    member: null,
    lead: { id: "lead-2", name: "Neha Gupta" },
  }
}

function qrSessionRow(id: string): ExportRowMap["qrSessions"] {
  return {
    id,
    label: "Front desk",
    expiresAt: NOW,
    revokedAt: null,
    createdAt: NOW,
    location: { name: "King's Gym" },
    createdBy: { name: "Ravi Verma" },
  }
}

function activityRow(id: string): ExportRowMap["leadActivities"] {
  return {
    id,
    type: "CALL",
    body: "Discussed plans",
    activityDate: NOW,
    createdAt: NOW,
    lead: { id: "lead-2", name: "Neha Gupta" },
    createdBy: null,
  }
}

function planRow(id: string): ExportRowMap["plans"] {
  return {
    id,
    name: "Annual Gold",
    billingInterval: "YEARLY",
    priceMinor: 250000,
    currency: "INR",
    durationDays: 365,
    description: null,
    active: true,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function trainerRow(id: string): ExportRowMap["trainers"] {
  return {
    id,
    user: { name: "Ravi Verma", email: "ravi@kingsgym.in", phone: "+91 95555 55555", role: "TRAINER", status: "ACTIVE" },
    bio: "Strength coach",
    specialties: ["STRENGTH"],
    active: true,
    createdAt: NOW,
    updatedAt: NOW,
    _count: { members: 2 },
  }
}

function financialRow(memberId: string, paidMinor: number): MemberFinancialSummaryRow {
  return {
    memberId,
    memberName: "Aarav Sharma",
    currentPlan: "Annual Gold",
    currentStatus: "ACTIVE",
    currentStartKey: "2026-09-01",
    currentEndKey: "2026-09-30",
    totalMembershipValueMinor: 250000,
    totalPaidMinor: paidMinor,
    paymentCount: 2,
    latestPaymentMinor: 50000,
    latestPaymentKey: "2026-09-18",
    methods: ["UPI"],
  }
}

function fullInput(): WorkbookBuildInput {
  const sheets: WorkbookSheetData[] = [
    { key: "members", rows: [memberRow("mem-1"), memberRow("mem-2")] },
    { key: "memberships", rows: [membershipRow("ms-1", 200000, 250000), membershipRow("ms-2", 120000, 150000)] },
    { key: "payments", rows: [paymentRow("pay-1", "RECORDED", 50000), paymentRow("pay-2", "RECORDED", 20000), paymentRow("pay-3", "VOIDED", 9999)] },
    { key: "plans", rows: [planRow("plan-1")] },
    { key: "attendance", rows: [attendanceRow("ck-1")] },
    { key: "qrSessions", rows: [qrSessionRow("qr-1")] },
    { key: "leads", rows: [leadRow("lead-1"), leadRow("lead-2")] },
    { key: "leadActivities", rows: [activityRow("act-1")] },
    { key: "trainers", rows: [trainerRow("tr-1")] },
    { key: "appointments", rows: [appointmentRow("apt-1")] },
    { key: "tasks", rows: [taskRow("task-1")] },
  ]
  const workbook = {
    gymName: "King's Gym",
    categories: [...EXPORT_SHEET_ORDER],
    range: { mode: "all" } as const,
    timeZone: TZ,
    generatedAt: NOW,
    counts: counts(),
    sheets,
    financialRows: [financialRow("mem-1", 70000), financialRow("mem-2", 0)],
  }
  return workbook
}

async function parseWorkbook(input: WorkbookBuildInput = fullInput()): Promise<ExcelJS.Workbook> {
  const { buffer } = await buildWorkbookFile(input)
  const workbook = new ExcelJS.Workbook()
  // exceljs types pin an older non-generic `Buffer`; the runtime accepts any
  // Node buffer, so the modern generic Buffer is coerced for type checking.
  await workbook.xlsx.load(buffer as never)
  return workbook
}

function hyperlinkOf(cell: ExcelJS.Cell): string | undefined {
  if (cell.hyperlink) return String(cell.hyperlink)
  const value = cell.value
  if (value && typeof value === "object" && "hyperlink" in value) return String((value as { hyperlink: unknown }).hyperlink)
  return undefined
}

function textOf(cell: ExcelJS.Cell): string {
  const value = cell.value
  if (value && typeof value === "object" && "text" in value) return String((value as { text: unknown }).text ?? "")
  return String(value ?? "")
}

function findRowByText(sheet: ExcelJS.Worksheet, needle: string): { row: number; column: number } | null {
  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r)
    for (let c = 1; c <= row.cellCount; c++) {
      const value = row.getCell(c).value
      const text = typeof value === "object" && value !== null && "text" in value
        ? (value as { text: unknown }).text
        : value
      if (String(text ?? "") === needle) return { row: r, column: c }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Sheet order + reconciliation
// ---------------------------------------------------------------------------

test("workbook: Summary comes first, then all modules in order with MFS right after Payments", async () => {
  const workbook = await parseWorkbook()
  const names = workbook.worksheets.map((ws) => ws.name)
  assert.deepEqual(names, [
    "Summary",
    "Members",
    "Memberships",
    "Payments",
    "Member Financial Summary",
    "Plans",
    "Attendance",
    "QR Sessions",
    "Leads",
    "Lead Activities",
    "Trainers",
    "Appointments",
    "Tasks",
  ])
})

test("workbook: every detail sheet holds exactly the records passed (record-level), plus nav + header rows", async () => {
  const workbook = await parseWorkbook()
  const expected: Array<[string, number]> = [
    ["Members", 2],
    ["Memberships", 2],
    ["Payments", 3], // every transaction including VOIDED stays a row
    ["Member Financial Summary", 2],
    ["Plans", 1],
    ["Attendance", 1],
    ["QR Sessions", 1],
    ["Leads", 2],
    ["Lead Activities", 1],
    ["Trainers", 1],
    ["Appointments", 1],
    ["Tasks", 1],
  ]
  for (const [name, dataRows] of expected) {
    const sheet = workbook.getWorksheet(name)
    assert.ok(sheet, `missing sheet ${name}`)
    assert.equal(sheet.rowCount, dataRows + 2, `${name} should have exactly ${dataRows} data rows`)
  }
})

test("workbook: Summary module index counts reconcile with the detail sheets", async () => {
  const workbook = await parseWorkbook()
  const summary = workbook.getWorksheet("Summary")!
  for (const [label, expected] of [
    ["Members", 2],
    ["Memberships", 2],
    ["Payments", 3],
    ["Member Financial Summary", 2],
    ["Attendance", 1],
    ["Leads", 2],
    ["Trainers", 1],
    ["Tasks", 1],
  ] as Array<[string, number]>) {
    const hit = findRowByText(summary, label)
    assert.ok(hit, `module ${label} missing from Summary index`)
    const countCell = summary.getRow(hit.row).getCell(hit.column + 1)
    assert.equal(countCell.value, expected, `${label} summary count should match its sheet`)
  }
})

test("workbook: no pagination truncation — a sheet over the batch size keeps every row", async () => {
  const input = fullInput()
  input.sheets = [{ key: "attendance", rows: Array.from({ length: 1001 }, (_, i) => attendanceRow(`ck-${i}`)) }]
  const workbook = await parseWorkbook(input)
  const sheet = workbook.getWorksheet("Attendance")!
  assert.equal(sheet.rowCount, 1001 + 2)
})

// ---------------------------------------------------------------------------
// Clickable navigation
// ---------------------------------------------------------------------------

test("workbook: Summary index module names and Open Sheet cells are internal hyperlinks", async () => {
  const workbook = await parseWorkbook()
  const summary = workbook.getWorksheet("Summary")!
  for (const label of ["Members", "Payments", "Attendance", "Leads", "Trainers", "Member Financial Summary"]) {
    const hit = findRowByText(summary, label)
    assert.ok(hit, `module ${label} missing from Summary index`)
    const moduleCell = summary.getRow(hit.row).getCell(hit.column)
    assert.equal(hyperlinkOf(moduleCell), `#'${label}'!A1`, `module name should link to ${label}`)
    const openCell = summary.getRow(hit.row).getCell(4)
    assert.equal(hyperlinkOf(openCell), `#'${label}'!A1`, `Open Sheet should link to ${label}`)
    assert.equal(textOf(openCell), "Open Sheet")
  }
})

test("workbook: every detail sheet has a Back-to-Summary hyperlink in its nav row", async () => {
  const workbook = await parseWorkbook()
  for (const name of workbook.worksheets.map((ws) => ws.name).filter((n) => n !== "Summary")) {
    const sheet = workbook.getWorksheet(name)!
    const a1 = sheet.getCell("A1")
    assert.equal(hyperlinkOf(a1), "#'Summary'!A1", `${name} A1 should link back to Summary`)
  }
})

test("workbook: detail-sheet nav rows carry Previous/Next links where they exist", async () => {
  const workbook = await parseWorkbook()
  const members = workbook.getWorksheet("Members")!
  assert.equal(hyperlinkOf(members.getCell("B1")), undefined) // first module has no previous
  assert.equal(hyperlinkOf(members.getCell("C1")), "#'Memberships'!A1")
  const tasks = workbook.getWorksheet("Tasks")!
  assert.equal(hyperlinkOf(tasks.getCell("B1")), "#'Appointments'!A1")
  assert.equal(hyperlinkOf(tasks.getCell("C1")), undefined) // last module has no next
})

// ---------------------------------------------------------------------------
// Column/format correctness
// ---------------------------------------------------------------------------

test("workbook: new relationship ID columns are present and populated", async () => {
  const workbook = await parseWorkbook()
  const headers = (name: string): string[] => {
    const sheet = workbook.getWorksheet(name)!
    return Array.from({ length: sheet.columnCount }, (_, i) => String(sheet.getRow(2).getCell(i + 1).value))
  }
  assert.ok(headers("Memberships").includes("Plan Price (INR)"))
  assert.ok(headers("Payments").includes("Plan ID"))
  assert.ok(headers("Attendance").includes("QR Session ID"))
  assert.ok(headers("Appointments").includes("Member ID") && headers("Appointments").includes("Lead ID"))
  assert.ok(headers("Tasks").includes("Member ID") && headers("Tasks").includes("Lead ID"))
  assert.ok(headers("Lead Activities").includes("Lead ID"))
  assert.ok(headers("Trainers").includes("Members Assigned"))

  const payments = workbook.getWorksheet("Payments")!
  const planCol = headers("Payments").indexOf("Plan ID") + 1
  assert.equal(payments.getRow(3).getCell(planCol).value, "plan-1")
  const attendance = workbook.getWorksheet("Attendance")!
  const qrCol = headers("Attendance").indexOf("QR Session ID") + 1
  assert.equal(attendance.getRow(3).getCell(qrCol).value, "")

  assert.ok(!headers("Trainers").join(" ").toLowerCase().includes("password"))
})

test("workbook: money columns are numeric with INR-style two-decimal formatting", async () => {
  const workbook = await parseWorkbook()
  const memberships = workbook.getWorksheet("Memberships")!
  const headers = Array.from({ length: memberships.columnCount }, (_, i) => String(memberships.getRow(2).getCell(i + 1).value))
  const amountCol = headers.indexOf("Amount (INR)") + 1
  const planPriceCol = headers.indexOf("Plan Price (INR)") + 1
  const amountCell = memberships.getRow(3).getCell(amountCol)
  const priceCell = memberships.getRow(3).getCell(planPriceCol)
  assert.equal(amountCell.value, 2000) // 200000 paise → ₹2,000.00
  assert.equal(amountCell.numFmt, "#,##0.00")
  assert.equal(priceCell.value, 2500)
  assert.equal(priceCell.numFmt, "#,##0.00")
})

test("workbook: VOIDED payments stay as rows but never appear in collected revenue", async () => {
  const workbook = await parseWorkbook()
  const payments = workbook.getWorksheet("Payments")!
  const headers = Array.from({ length: payments.columnCount }, (_, i) => String(payments.getRow(2).getCell(i + 1).value))
  const statusCol = headers.indexOf("Payment Status") + 1
  assert.equal(payments.getRow(5).getCell(statusCol).value, "VOIDED")
})

// ---------------------------------------------------------------------------
// Summary sections + emptiness
// ---------------------------------------------------------------------------

test("workbook: Summary has the three required sections and business overview", async () => {
  const workbook = await parseWorkbook()
  const summary = workbook.getWorksheet("Summary")!
  assert.ok(findRowByText(summary, "1 · Export Information"))
  assert.ok(findRowByText(summary, "2 · Clickable Module Index"))
  assert.ok(findRowByText(summary, "3 · Business Overview"))
  const gym = findRowByText(summary, "Gym")
  assert.ok(gym)
  assert.equal(summary.getRow(gym.row).getCell(2).value, "King's Gym")
})

test("workbook: empty modules are skipped entirely (no blank sheets, no index rows)", async () => {
  const input = fullInput()
  input.sheets = input.sheets.filter((s) => s.key !== "appointments" && s.key !== "qrSessions")
  input.categories = input.categories.filter((k) => k !== "appointments" && k !== "qrSessions")
  const workbook = await parseWorkbook(input)
  assert.equal(workbook.getWorksheet("Appointments"), undefined)
  assert.equal(workbook.getWorksheet("QR Sessions"), undefined)
  const summary = workbook.getWorksheet("Summary")!
  assert.equal(findRowByText(summary, "Appointments"), null)
})