import { NextResponse } from "next/server"
import type { Payment } from "@/lib/pos-types"
import { supabase } from "@/lib/supabase"
import { rowToPayment } from "@/lib/api/payments-db"

async function callGas(payments: Payment[]) {
  const gasUrl = process.env.GAS_WEBHOOK_URL
  if (!gasUrl) throw new Error("GAS_WEBHOOK_URL が未設定です")
  const res = await fetch(gasUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payments, secret: process.env.GAS_SECRET }),
  })
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data.error ?? "GAS 同期エラー")
  return data as { syncedIds: string[] }
}

// 手動ボタン → GAS doPost に転送
export async function POST(request: Request) {
  try {
    const { payments } = (await request.json()) as { payments: Payment[] }
    const data = await callGas(payments)
    return NextResponse.json(data) // { syncedIds: [...] }
  } catch (err) {
    console.error("[Sheets Manual]", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// Vercel Cron → 未同期データを GAS に転送
export async function GET() {
  try {
    const { data, error } = await supabase
      .from("payments")
      .select("*")
      .is("synced_to_sheet_at", null)
      .is("canceled_at", null)
      .order("payment_datetime", { ascending: true })
    if (error) throw error

    if (!data || data.length === 0) {
      return NextResponse.json({ message: "同期対象なし", syncedCount: 0 })
    }

    const payments = (data as Record<string, unknown>[]).map(rowToPayment)
    const result = await callGas(payments)
    return NextResponse.json({ ...result, syncedCount: payments.length })
  } catch (err) {
    console.error("[Sheets Cron]", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
