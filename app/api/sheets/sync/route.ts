import { NextResponse } from "next/server"
import { syncPaymentsToSheet } from "@/lib/api/sheets"
import type { Payment } from "@/lib/pos-types"

// Vercel Cron からの定期実行（Supabase から直接取得）
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const { fetchUnsyncedPayments } = await import("@/lib/api/payments-db")
    const payments = await fetchUnsyncedPayments()
    const syncedIds = await syncPaymentsToSheet(payments)
    // Cron の場合は DB も更新
    if (syncedIds.length > 0) {
      const { markPaymentsSynced } = await import("@/lib/api/payments-db")
      await markPaymentsSynced(syncedIds)
    }
    return NextResponse.json({ synced: syncedIds.length })
  } catch (err) {
    console.error("[Sheets Cron]", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// 管理画面からの手動実行（クライアントから payments を受け取る）
export async function POST(request: Request) {
  try {
    const body = await request.json() as { payments: Payment[] }
    const payments: Payment[] = (body.payments ?? []).filter(
      (p) => !p.syncedToSheetAt && !p.canceledAt
    )
    if (payments.length === 0) {
      return NextResponse.json({ syncedIds: [] })
    }
    const syncedIds = await syncPaymentsToSheet(payments)
    return NextResponse.json({ syncedIds })
  } catch (err) {
    console.error("[Sheets Manual]", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
