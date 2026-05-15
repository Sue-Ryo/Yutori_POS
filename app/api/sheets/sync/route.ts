import { NextResponse } from "next/server"
import { fetchUnsyncedPayments } from "@/lib/api/payments-db"
import { syncUnsyncedPayments } from "@/lib/api/sheets"

async function runSync() {
  const payments = await fetchUnsyncedPayments()
  const count = await syncUnsyncedPayments(payments)
  return count
}

// Vercel Cron からの定期実行
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const count = await runSync()
    return NextResponse.json({ synced: count })
  } catch (err) {
    console.error("[Sheets Cron]", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// 管理画面からの手動実行
export async function POST() {
  try {
    const count = await runSync()
    return NextResponse.json({ synced: count })
  } catch (err) {
    console.error("[Sheets Manual]", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
