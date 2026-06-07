import { NextResponse } from "next/server"

const SQUARE_BASE = process.env.SQUARE_ENVIRONMENT === "sandbox"
  ? "https://connect.squareupsandbox.com"
  : "https://connect.squareup.com"

const SQUARE_VERSION = "2024-01-18"

function headers() {
  return {
    "Square-Version": SQUARE_VERSION,
    "Authorization": `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  }
}

// ステータスポーリング
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ checkoutId: string }> },
) {
  const { checkoutId } = await params
  const res = await fetch(`${SQUARE_BASE}/v2/terminals/checkouts/${checkoutId}`, {
    headers: headers(),
  })

  const data = await res.json() as {
    checkout?: { status: string; payment_ids?: string[] }
    errors?: { detail: string }[]
  }
  if (!res.ok || !data.checkout) {
    return NextResponse.json(
      { error: data.errors?.[0]?.detail ?? "Square ステータス取得失敗" },
      { status: 500 },
    )
  }

  return NextResponse.json({
    status: data.checkout.status,
    paymentId: data.checkout.payment_ids?.[0] ?? null,
  })
}

// キャンセル
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ checkoutId: string }> },
) {
  const { checkoutId } = await params
  const res = await fetch(`${SQUARE_BASE}/v2/terminals/checkouts/${checkoutId}/cancel`, {
    method: "POST",
    headers: headers(),
  })

  if (!res.ok) {
    const data = await res.json() as { errors?: { detail: string }[] }
    return NextResponse.json(
      { error: data.errors?.[0]?.detail ?? "Square キャンセル失敗" },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true })
}
