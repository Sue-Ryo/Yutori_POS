import { NextResponse } from "next/server"
import type { Payment } from "@/lib/pos-types"

// 手動ボタン → GAS doPost に転送
export async function POST(request: Request) {
  try {
    const { payments } = (await request.json()) as { payments: Payment[] }
    const gasUrl = process.env.GAS_WEBHOOK_URL
    if (!gasUrl) {
      return NextResponse.json({ error: "GAS_WEBHOOK_URL が未設定です" }, { status: 500 })
    }
    const res = await fetch(gasUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payments,
        secret: process.env.GAS_SECRET,
      }),
    })
    const data = await res.json()
    if (!res.ok || data.error) throw new Error(data.error ?? "GAS 同期エラー")
    return NextResponse.json(data) // { syncedIds: [...] }
  } catch (err) {
    console.error("[Sheets Manual]", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// Vercel Cron は GAS タイマートリガーに任せるため不要
export async function GET() {
  return NextResponse.json({ message: "sync は GAS タイマートリガーが担当しています" })
}
