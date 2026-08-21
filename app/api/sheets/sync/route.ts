import { NextResponse } from "next/server"
import type { Payment } from "@/lib/pos-types"
import { supabase } from "@/lib/supabase"
import { rowToPayment, markPaymentsSynced } from "@/lib/api/payments-db"

// 店舗ID → GAS Webhook URL の解決
// GAS_WEBHOOK_URL : 通常はこれだけでよい。1つの GAS が全店舗ぶんのシートを書く
// GAS_WEBHOOK_URLS: JSON 形式 {"1":"https://...","4":"https://..."}
//                   店舗ごとに GAS を分ける場合のみ。個別指定が優先される
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
  return process.env.GAS_WEBHOOK_URL ?? null
}

// storeIds は GAS 側で「どの店舗シートを再構築するか」の絞り込みに使う
async function callGas(gasUrl: string, payments: Payment[], storeIds: number[]) {
  const res = await fetch(gasUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payments, storeIds, secret: process.env.GAS_SECRET }),
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
    if (!gasUrl) throw new Error(`店舗ID ${storeId} のGAS URLが未設定です（GAS_WEBHOOK_URL / GAS_WEBHOOK_URLS）`)
    const data = await callGas(gasUrl, payments, [storeId])
    return NextResponse.json(data) // { syncedIds: [...] }
  } catch (err) {
    console.error("[Sheets Manual]", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// Vercel Cron → 未同期データを GAS へ転送
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

    // 送信先URLごとにまとめる。全店舗が同じ GAS なら1回の呼び出しで済む
    const byUrl = new Map<string, { storeIds: Set<number>; rows: Record<string, unknown>[] }>()
    const skippedStores = new Set<number>()
    for (const row of data as Record<string, unknown>[]) {
      const storeId = Number(row.store_id ?? 1)
      const gasUrl = gasUrlForStore(storeId)
      if (!gasUrl) {
        skippedStores.add(storeId) // URL未設定の店舗は未同期のまま残す
        continue
      }
      const group = byUrl.get(gasUrl) ?? { storeIds: new Set<number>(), rows: [] }
      group.storeIds.add(storeId)
      group.rows.push(row)
      byUrl.set(gasUrl, group)
    }

    const allSyncedIds: string[] = []
    for (const [gasUrl, group] of byUrl) {
      const payments = group.rows.map(rowToPayment)
      const result = await callGas(gasUrl, payments, [...group.storeIds])
      if (result.syncedIds && result.syncedIds.length > 0) {
        await markPaymentsSynced(result.syncedIds)
        allSyncedIds.push(...result.syncedIds)
      }
    }

    return NextResponse.json({
      syncedIds: allSyncedIds,
      syncedCount: allSyncedIds.length,
      ...(skippedStores.size > 0 ? { skippedStores: [...skippedStores] } : {}),
    })
  } catch (err) {
    console.error("[Sheets Cron]", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
