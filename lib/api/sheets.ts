import { google } from "googleapis"
import { supabase } from "@/lib/supabase"
import type { Payment } from "@/lib/pos-types"

const DAYS_JA = ["日", "月", "火", "水", "木", "金", "土"]
const SHEET_HEADERS = ["No.", "顧客名/席名", "人数", "入店時間", "会計時間", "滞在(分)", "合計(税込)", "支払方法", "割引額", "消費税"]

function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    },
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive",
    ],
  })
}

// "2025-07-01" → "2025-07"
function toYearMonth(businessDate: string): string {
  return businessDate.slice(0, 7)
}

// "2025-07-01" → "7/1(火)"
function toSheetTitle(businessDate: string): string {
  const d = new Date(businessDate + "T00:00:00")
  return `${d.getMonth() + 1}/${d.getDate()}(${DAYS_JA[d.getDay()]})`
}

// "2025-07" → "2025年7月 会計データ"
function toSpreadsheetTitle(yearMonth: string): string {
  const [year, month] = yearMonth.split("-")
  return `${year}年${parseInt(month)}月 会計データ`
}

function formatTime(d: Date): string {
  return new Date(d).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
}

async function getOrCreateSpreadsheet(yearMonth: string): Promise<string> {
  const { data } = await supabase
    .from("sheet_registry")
    .select("spreadsheet_id")
    .eq("month", yearMonth)
    .maybeSingle()

  if (data?.spreadsheet_id) return data.spreadsheet_id as string

  const auth = getAuth()
  const sheets = google.sheets({ version: "v4", auth })
  const drive = google.drive({ version: "v3", auth })

  const createRes = await sheets.spreadsheets.create({
    requestBody: { properties: { title: toSpreadsheetTitle(yearMonth) } },
  })
  const spreadsheetId = createRes.data.spreadsheetId!

  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID
  if (folderId) {
    const fileRes = await drive.files.get({ fileId: spreadsheetId, fields: "parents" })
    const prevParents = (fileRes.data.parents ?? []).join(",")
    await drive.files.update({
      fileId: spreadsheetId,
      addParents: folderId,
      removeParents: prevParents,
      requestBody: {},
      fields: "id,parents",
    })
  }

  await supabase.from("sheet_registry").insert({ month: yearMonth, spreadsheet_id: spreadsheetId })

  return spreadsheetId
}

async function ensureDaySheet(spreadsheetId: string, sheetTitle: string): Promise<void> {
  const auth = getAuth()
  const sheets = google.sheets({ version: "v4", auth })

  const res = await sheets.spreadsheets.get({ spreadsheetId })
  const exists = res.data.sheets?.some((s) => s.properties?.title === sheetTitle)

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: sheetTitle } } }] },
    })
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetTitle}'!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [SHEET_HEADERS] },
    })
  }
}

async function getExistingRowCount(spreadsheetId: string, sheetTitle: string): Promise<number> {
  const auth = getAuth()
  const sheets = google.sheets({ version: "v4", auth })
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetTitle}'!A:A`,
  })
  return Math.max(0, (res.data.values?.length ?? 1) - 1)
}

async function appendRows(spreadsheetId: string, sheetTitle: string, rows: unknown[][]): Promise<void> {
  const auth = getAuth()
  const sheets = google.sheets({ version: "v4", auth })
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${sheetTitle}'!A:J`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: rows },
  })
}

export async function syncUnsyncedPayments(payments: Payment[]): Promise<number> {
  const unsynced = payments.filter((p) => !p.syncedToSheetAt && !p.canceledAt)
  if (unsynced.length === 0) return 0

  // 月ごとにグループ化
  const byMonth: Record<string, Payment[]> = {}
  for (const p of unsynced) {
    const ym = toYearMonth(p.businessDate)
    ;(byMonth[ym] ??= []).push(p)
  }

  const syncedIds: string[] = []

  for (const [yearMonth, monthPayments] of Object.entries(byMonth)) {
    const spreadsheetId = await getOrCreateSpreadsheet(yearMonth)

    // 日ごとにグループ化
    const byDay: Record<string, Payment[]> = {}
    for (const p of monthPayments) {
      ;(byDay[p.businessDate] ??= []).push(p)
    }

    for (const [businessDate, dayPayments] of Object.entries(byDay)) {
      const sheetTitle = toSheetTitle(businessDate)
      await ensureDaySheet(spreadsheetId, sheetTitle)

      const existingCount = await getExistingRowCount(spreadsheetId, sheetTitle)
      const sorted = [...dayPayments].sort(
        (a, b) => new Date(a.paymentDatetime).getTime() - new Date(b.paymentDatetime).getTime()
      )

      const rows = sorted.map((p, i) => {
        const startTime = p.sessionStartedAt ? formatTime(p.sessionStartedAt) : ""
        const endTime = formatTime(p.paymentDatetime)
        const stayMins = p.sessionStartedAt
          ? Math.round((new Date(p.paymentDatetime).getTime() - new Date(p.sessionStartedAt).getTime()) / 60000)
          : ""
        const payMethod = p.cashlessAmount > 0 && p.cashAmount === 0 ? "キャッシュレス" : "現金"

        return [
          existingCount + i + 1,
          p.customerName ?? "",
          p.guestCount,
          startTime,
          endTime,
          stayMins,
          p.totalAmount,
          payMethod,
          p.discountAmount,
          p.taxAmount,
        ]
      })

      await appendRows(spreadsheetId, sheetTitle, rows)
      syncedIds.push(...sorted.map((p) => p.id))
    }
  }

  // 同期済みに更新
  if (syncedIds.length > 0) {
    const now = new Date().toISOString()
    await supabase.from("payments").update({ synced_to_sheet_at: now }).in("id", syncedIds)
  }

  return syncedIds.length
}
