import ExcelJS from "exceljs"

import {
  CATEGORY_META,
  dataRangeLabel,
  EXPORT_SHEET_ORDER,
  isFullExportRange,
  type DataCategoryKey,
  type DataDateRange,
} from "@/lib/data-catalog"
import {
  buildModuleIndexRows,
  buildSummaryRows,
  COLUMN_NUMFMT,
  exportWorkbookFilename,
  EXPORT_COLUMNS,
  FINANCIAL_SUMMARY_COLUMNS,
  mapExportRow,
  mapFinancialSummaryRow,
  MEMBER_FINANCIAL_DESCRIPTION,
  type AnyExportRow,
  type DateCell,
  type ExcelCell,
  type ExportColumn,
  type ModuleIndexItem,
  type SummaryCounts,
  type SummaryRow,
} from "@/lib/data-export-mapping"
import type { MemberFinancialSummaryRow } from "@/lib/data-financials"

/**
 * PURE workbook assembly (no prisma, no server-only) so it can be unit-tested
 * by rendering real .xlsx buffers and parsing them back with ExcelJS.
 *
 * Produces a professional, clickable workbook:
 *   1. Summary (always first)   — 3 sections: Export Information, Clickable
 *                                Module Index (hyperlinks into every sheet),
 *                                Business Overview (statuses + revenue).
 *   2. Detail sheets            — one per selected module in EXPORT_SHEET_ORDER.
 *                                Every sheet has a "← Back to Summary" nav row
 *                                (plus Previous/Next), a styled frozen header
 *                                and an auto-filter.
 *   3. Member Financial Summary — placed right after Payments when financial
 *                                data is selected and rows exist.
 *
 * The module index counts are the ACTUAL row counts of the detail sheets, so
 * Summary totals always reconcile with the sheets under the same filters.
 */

export type WorkbookSheetData = {
  key: DataCategoryKey
  rows: AnyExportRow[]
}

export type WorkbookBuildInput = {
  gymName: string
  categories: DataCategoryKey[]
  range: DataDateRange
  timeZone: string
  generatedAt: Date
  counts: SummaryCounts
  /** Non-empty sheets, already in EXPORT_SHEET_ORDER. */
  sheets: WorkbookSheetData[]
  /** Derived member financial rows; empty array → the sheet is omitted. */
  financialRows: MemberFinancialSummaryRow[]
}

export type WorkbookBuildResult = {
  buffer: ArrayBuffer
  filename: string
}

// ---------------------------------------------------------------------------
// Cell / sheet helpers
// ---------------------------------------------------------------------------

function suggestedWidth(header: string, kind: ExportColumn["kind"]): number {
  if (kind === "date") return Math.max(12, header.length + 4)
  if (kind === "datetime") return Math.max(20, header.length + 4)
  if (kind === "money") return Math.max(14, header.length + 4)
  if (kind === "number") return Math.max(12, header.length + 4)
  if (header.endsWith("ID")) return Math.max(38, header.length + 4)
  return Math.min(Math.max(14, header.length + 6), 60)
}

function styleHeaderRow(sheet: ExcelJS.Worksheet, rowNumber: number): void {
  const row = sheet.getRow(rowNumber)
  row.height = 30
  row.font = { bold: true, color: { argb: "FFFFFFFF" } }
  row.alignment = { vertical: "middle", horizontal: "center", wrapText: true }
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } }
  row.border = {
    bottom: { style: "thin", color: { argb: "FF8EAADB" } },
  }
}

function applyColumnFormats(sheet: ExcelJS.Worksheet, columns: ExportColumn[]): void {
  columns.forEach((col, index) => {
    const column = sheet.getColumn(index + 1)
    const numFmt = COLUMN_NUMFMT[col.kind]
    if (numFmt) column.numFmt = numFmt
    if (col.kind === "money" || col.kind === "number") {
      column.alignment = { horizontal: "right" }
    }
  })
}

function isDateCell(cell: ExcelCell): cell is DateCell {
  return typeof cell === "object" && cell !== null && "kind" in cell
}

function writeRow(sheet: ExcelJS.Worksheet, cells: ExcelCell[], columns: ExportColumn[]): void {
  const row = sheet.addRow(cells.map((cell) => (isDateCell(cell) ? cell.value : cell)))
  columns.forEach((col, index) => {
    const numFmt = COLUMN_NUMFMT[col.kind]
    const cell = row.getCell(index + 1)
    if (numFmt) cell.numFmt = numFmt
    if (col.kind === "money" || col.kind === "number") {
      cell.alignment = { horizontal: "right" }
    }
  })
}

function applyAutoFilter(sheet: ExcelJS.Worksheet, columnCount: number, headerRow: number): void {
  sheet.autoFilter = {
    from: { row: headerRow, column: 1 },
    to: { row: Math.max(headerRow, sheet.rowCount), column: columnCount },
  }
}

function setHyperlink(cell: ExcelJS.Cell, text: string, target: string): void {
  cell.value = { text, hyperlink: target }
  cell.font = { color: { argb: "FF0563C1" }, underline: true }
}

/** Internal workbook reference, safe for sheet names using spaces. */
function sheetAnchor(sheetName: string): string {
  return `#'${sheetName}'!A1`
}

// ---------------------------------------------------------------------------
// Detail sheets
// ---------------------------------------------------------------------------

function addDetailSheet(
  workbook: ExcelJS.Workbook,
  key: DataCategoryKey,
  rows: AnyExportRow[],
  timeZone: string,
  index: number,
  allKeys: DataCategoryKey[]
): ExcelJS.Worksheet {
  const columns = EXPORT_COLUMNS[key]
  const sheetName = CATEGORY_META[key].label.slice(0, 31)
  const sheet = workbook.addWorksheet(sheetName)

  columns.forEach((col, i) => {
    sheet.getColumn(i + 1).width = suggestedWidth(col.header, col.kind)
  })

  // Navigation row 1
  const nav = sheet.getRow(1)
  nav.height = 20
  setHyperlink(sheet.getCell("A1"), "← Back to Summary", sheetAnchor("Summary"))
  const prev = allKeys[index - 1]
  const next = allKeys[index + 1]
  if (prev) setHyperlink(sheet.getCell("B1"), `← ${CATEGORY_META[prev].label}`, sheetAnchor(CATEGORY_META[prev].label.slice(0, 31)))
  if (next) setHyperlink(sheet.getCell("C1"), `${CATEGORY_META[next].label} →`, sheetAnchor(CATEGORY_META[next].label.slice(0, 31)))

  // Header row 2 (frozen with the nav row)
  columns.forEach((col, i) => {
    sheet.getCell(2, i + 1).value = col.header
  })
  styleHeaderRow(sheet, 2)
  applyColumnFormats(sheet, columns)
  sheet.views = [{ state: "frozen", ySplit: 2 }]

  for (const row of rows) writeRow(sheet, mapExportRow(key, row, timeZone), columns)
  applyAutoFilter(sheet, columns.length, 2)
  return sheet
}

function addMemberFinancialSummarySheet(
  workbook: ExcelJS.Workbook,
  rows: MemberFinancialSummaryRow[],
  prevKey: NavKey,
  nextKey: NavKey | undefined
): ExcelJS.Worksheet {
  const sheetName = "Member Financial Summary"
  const sheet = workbook.addWorksheet(sheetName)

  FINANCIAL_SUMMARY_COLUMNS.forEach((col, i) => {
    sheet.getColumn(i + 1).width = suggestedWidth(col.header, col.kind)
  })

  setHyperlink(sheet.getCell("A1"), "← Back to Summary", sheetAnchor("Summary"))
  if (prevKey) setHyperlink(sheet.getCell("B1"), `← ${navLabel(prevKey)}`, sheetAnchor(sheetNameFor(prevKey)))
  if (nextKey) setHyperlink(sheet.getCell("C1"), `${navLabel(nextKey)} →`, sheetAnchor(sheetNameFor(nextKey)))

  FINANCIAL_SUMMARY_COLUMNS.forEach((col, i) => {
    sheet.getCell(2, i + 1).value = col.header
  })
  styleHeaderRow(sheet, 2)
  applyColumnFormats(sheet, FINANCIAL_SUMMARY_COLUMNS)
  sheet.views = [{ state: "frozen", ySplit: 2 }]

  for (const row of rows) writeRow(sheet, mapFinancialSummaryRow(row), FINANCIAL_SUMMARY_COLUMNS)
  applyAutoFilter(sheet, FINANCIAL_SUMMARY_COLUMNS.length, 2)
  return sheet
}

// ---------------------------------------------------------------------------
// Summary sheet (3 sections)
// ---------------------------------------------------------------------------

/**
 * Navigation neighbours inside a workbook: a selectable category, or the
 * derived "financial" sheet (Member Financial Summary).
 */
type NavKey = DataCategoryKey | "financial"

function navLabel(key: NavKey): string {
  if (key === "financial") return "Member Financial Summary"
  return CATEGORY_META[key].label
}

function sheetNameFor(key: NavKey): string {
  return navLabel(key).slice(0, 31)
}

type IndexLevel = {
  items: ModuleIndexItem[]
  financialCount: number
}

function buildIndexItems(sheets: WorkbookSheetData[], financialCount: number): IndexLevel {
  const keys = sheets.map((s) => s.key)
  const counts = sheets.map((s) => s.rows.length)
  return { items: buildModuleIndexRows(keys, counts), financialCount }
}

function mergedSectionTitle(sheet: ExcelJS.Worksheet, rowNumber: number, text: string): void {
  sheet.mergeCells(rowNumber, 1, rowNumber, 4)
  const row = sheet.getRow(rowNumber)
  row.height = 22
  const cell = row.getCell(1)
  cell.value = text
  cell.font = { bold: true, size: 12, color: { argb: "FF1F4E78" } }
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDEBF7" } }
  cell.alignment = { vertical: "middle" }
}

function writeInfoRow(sheet: ExcelJS.Worksheet, label: string, value: string | number): void {
  const row = sheet.addRow([label, value])
  const valueCell = row.getCell(2)
  if (typeof value === "number") {
    valueCell.numFmt = "#,##0"
    valueCell.alignment = { horizontal: "right" }
  }
}

function writeSummaryValueRow(sheet: ExcelJS.Worksheet, row: SummaryRow): void {
  const excelRow = sheet.addRow([row.metric, row.value])
  const valueCell = excelRow.getCell(2)
  if (typeof row.value === "number") {
    valueCell.numFmt = row.money ? "#,##0.00" : "#,##0"
    valueCell.alignment = { horizontal: "right" }
  }
  if (row.metric === "Note") {
    valueCell.alignment = { wrapText: true, vertical: "top" }
  }
  if (row.metric.startsWith("  ")) {
    excelRow.getCell(1).font = { color: { argb: "FF595959" } }
  }
}

function addSummarySheet(
  workbook: ExcelJS.Workbook,
  input: WorkbookBuildInput,
  indexLevel: IndexLevel
): void {
  const sheet = workbook.addWorksheet("Summary")
  const widths = [36, 18, 62, 16]
  widths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w
  })

  const rangeLabel = isFullExportRange(input.range)
    ? "All Time (full export)"
    : dataRangeLabel(input.range)
  const moduleTotal = EXPORT_SHEET_ORDER.length
  const selectedCount = input.categories.length
  const exportType =
    selectedCount >= moduleTotal
      ? `Full export — all ${moduleTotal} modules`
      : `Partial export — ${selectedCount} of ${moduleTotal} modules`

  // Sheet title
  sheet.mergeCells(1, 1, 1, 4)
  const title = sheet.getCell("A1")
  title.value = `${input.gymName} — Business Data Export`
  title.font = { bold: true, size: 15, color: { argb: "FF1F4E78" } }

  // --- Section 1: Export Information --------------------------------------
  mergedSectionTitle(sheet, 3, "1 · Export Information")
  writeInfoRow(sheet, "Gym", input.gymName)
  writeInfoRow(sheet, "Export generated at", `${input.generatedAt.toISOString()} (${input.timeZone})`)
  writeInfoRow(sheet, "Date range", rangeLabel)
  writeInfoRow(sheet, "Timezone", input.timeZone)
  writeInfoRow(sheet, "Export type", exportType)

  // --- Section 2: Clickable Module Index -----------------------------------
  mergedSectionTitle(sheet, sheet.rowCount + 2, "2 · Clickable Module Index")
  const indexHeader = sheet.addRow(["Module", "Total Records", "Description", "Open Sheet"])
  indexHeader.height = 22
  for (let i = 1; i <= 4; i++) {
    const cell = indexHeader.getCell(i)
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } }
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } }
    cell.alignment = { vertical: "middle", horizontal: "center" }
  }

  for (const item of indexLevel.items) {
    const row = sheet.addRow([item.label, item.count, item.description, "Open Sheet"])
    setHyperlink(row.getCell(1), item.label, sheetAnchor(item.sheetName))
    row.getCell(2).numFmt = "#,##0"
    row.getCell(2).alignment = { horizontal: "right" }
    setHyperlink(row.getCell(4), "Open Sheet", sheetAnchor(item.sheetName))
  }
  if (indexLevel.financialCount > 0) {
    const row = sheet.addRow([
      "Member Financial Summary",
      indexLevel.financialCount,
      MEMBER_FINANCIAL_DESCRIPTION,
      "Open Sheet",
    ])
    setHyperlink(row.getCell(1), "Member Financial Summary", sheetAnchor("Member Financial Summary"))
    row.getCell(2).numFmt = "#,##0"
    row.getCell(2).alignment = { horizontal: "right" }
    setHyperlink(row.getCell(4), "Open Sheet", sheetAnchor("Member Financial Summary"))
  }

  // --- Section 3: Business Overview ----------------------------------------
  mergedSectionTitle(sheet, sheet.rowCount + 2, "3 · Business Overview")
  const overviewRows = buildSummaryRows({
    gymName: input.gymName,
    timeZone: input.timeZone,
    generatedAt: input.generatedAt,
    rangeLabel,
    counts: input.counts,
    selectedCategories: input.categories,
    includeHeader: false,
  })
  for (const row of overviewRows) writeSummaryValueRow(sheet, row)
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function buildWorkbookFile(input: WorkbookBuildInput): Promise<WorkbookBuildResult> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = input.gymName
  workbook.created = input.generatedAt

  const selected = new Set<DataCategoryKey>(input.categories)
  const sheetKeys = EXPORT_SHEET_ORDER.filter(
    (key) => selected.has(key) && input.sheets.some((s) => s.key === key && s.rows.length > 0)
  )

  // Summary first, using the real sheet row counts for its module index.
  const indexLevel = buildIndexItems(input.sheets, input.financialRows.length)
  addSummarySheet(workbook, input, indexLevel)

  // Detail sheets in canonical order; the Member Financial Summary sits right
  // after Payments so the money narrative flows: Payments → Member Finances.
  for (const key of sheetKeys) {
    const data = input.sheets.find((s) => s.key === key)!
    const sheetIndex = sheetKeys.indexOf(key)
    addDetailSheet(workbook, key, data.rows, input.timeZone, sheetIndex, sheetKeys)
    if (key === "payments" && input.financialRows.length > 0) {
      const nextKey = sheetKeys[sheetIndex + 1]
      addMemberFinancialSummarySheet(workbook, input.financialRows, "payments", nextKey)
    }
  }

  return (async () => {
    const buffer = await workbook.xlsx.writeBuffer()
    return {
      buffer: toArrayBuffer(buffer),
      filename: exportWorkbookFilename(input.gymName, input.timeZone, input.generatedAt),
    }
  })()
}

function toArrayBuffer(value: Buffer | ArrayBuffer): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer
}