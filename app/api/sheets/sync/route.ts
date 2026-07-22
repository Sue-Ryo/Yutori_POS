import { NextResponse } from "next/server"
import type { Payment } from "@/lib/pos-types"
import { supabase } from "@/lib/supabase"
import { rowToPayment, markPaymentsSynced } from "@/lib/api/payments-db"

// 店舗ID → GAS Webhook URL の解決
// GAS_WEBHOOK_URLS: JSON 形式 {"1":"https://...","4":"https://..."}（店舗ごとにGASデプロイを分ける場合）
// GAS_WEBHOOK_URL : 従来の単一URL。未マッピング時は store 1（目黒店）のURLとして扱う
function gasUrlForStore(storeId: number): string | null {
  const mapping = process.env.GAS_WEBHOOK_URLS
  if (mapping) {
    try {
      const urls = JSON.parse(mapping) as Record<string, string>
      if (urls[String(storeId)]) return urls[String(storeId)]
    } catch (e) {
      console.error("[Sheets] GAS_WEBHOOK_URLS のJSONが不正です:", e)
    }
  }
  if (storeId === 1 && process.env.GAS_WEBHOOK_URL) return process.env.GAS_WEBHOOK_URL
  return null
}

async function callGas(gasUrl: string, payments: Payment[]) {
  const res = await fetch(gasUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payments, secret: process.env.GAS_SECRET }),
  })
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data.error ?? "GAS 同期エラー")
  return data as { syncedIds: string[] }
}

// 手動ボタン → 該当店舗の GAS doPost に転送
export async function POST(request: Request) {
  try {
    const { payments, storeId = 1 } = (await request.json()) as { payments: Payment[]; storeId?: number }
    const gasUrl = gasUrlForStore(storeId)
    if (!gasUrl) throw new Error(`店舗ID ${storeId} のGAS URLが未設定です（GAS_WEBHOOK_URLS / GAS_WEBHOOK_URL）`)
    const data = await callGas(gasUrl, payments)
    return NextResponse.json(data) // { syncedIds: [...] }
  } catch (err) {
    console.error("[Sheets Manual]", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// Vercel Cron → 未同期データを店舗ごとに GAS へ転送
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

    // 店舗ごとにグループ化し、それぞれのGASへ送信
    const byStore = new Map<number, Record<string, unknown>[]>()
    for (const row of data as Record<string, unknown>[]) {
      const storeId = Number(row.store_id ?? 1)
      const group = byStore.get(storeId) ?? []
      group.push(row)
      byStore.set(storeId, group)
    }

    const allSyncedIds: string[] = []
    const skippedStores: number[] = []
    for (const [storeId, rows] of byStore) {
      const gasUrl = gasUrlForStore(storeId)
      if (!gasUrl) {
        skippedStores.push(storeId) // URL未設定の店舗は未同期のまま残す
        continue
      }
      const payments = rows.map(rowToPayment)
      const result = await callGas(gasUrl, payments)
      if (result.syncedIds && result.syncedIds.length > 0) {
        await markPaymentsSynced(result.syncedIds)
        allSyncedIds.push(...result.syncedIds)
      }
    }

    return NextResponse.json({
      syncedIds: allSyncedIds,
      syncedCount: allSyncedIds.length,
      ...(skippedStores.length > 0 ? { skippedStores } : {}),
    })
  } catch (err) {
    console.error("[Sheets Cron]", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
