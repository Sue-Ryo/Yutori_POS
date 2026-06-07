import { NextResponse } from "next/server"

const SQUARE_BASE = process.env.SQUARE_ENVIRONMENT === "sandbox"
  ? "https://connect.squareupsandbox.com"
  : "https://connect.squareup.com"

const SQUARE_VERSION = "2024-01-18"

export async function POST(request: Request) {
  const token = process.env.SQUARE_ACCESS_TOKEN
  const deviceId = process.env.SQUARE_DEVICE_ID
  if (!token || !deviceId) {
    return NextResponse.json({ error: "Square の環境変数が未設定です" }, { status: 500 })
  }

  const { amountMoney, referenceId } = await request.json() as {
    amountMoney: number
    referenceId?: string
  }

  const res = await fetch(`${SQUARE_BASE}/v2/terminals/checkouts`, {
    method: "POST",
    headers: {
      "Square-Version": SQUARE_VERSION,
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      idempotency_key: crypto.randomUUID(),
      checkout: {
        amount_money: { amount: amountMoney, currency: "JPY" },
        reference_id: referenceId ?? undefined,
        device_options: { device_id: deviceId },
      },
    }),
  })

  const data = await res.json() as { checkout?: { id: string }; errors?: { detail: string }[] }
  if (!res.ok || !data.checkout) {
    return NextResponse.json(
      { error: data.errors?.[0]?.detail ?? "Square チェックアウト作成失敗" },
      { status: 500 },
    )
  }

  return NextResponse.json({ checkoutId: data.checkout.id })
}
