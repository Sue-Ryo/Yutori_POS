import { NextResponse } from "next/server"

// Square アプリでの決済後、コールバックで戻れなかった会計を復旧するための照会。
// 金額と時刻でSquare側の決済履歴を突き合わせ、実際に決済されたかを確認する。
const SQUARE_BASE = process.env.SQUARE_ENVIRONMENT === "sandbox"
  ? "https://connect.squareupsandbox.com"
  : "https://connect.squareup.com"

const SQUARE_VERSION = "2024-01-18"

type SquarePayment = {
  id: string
  status?: string
  created_at?: string
  amount_money?: { amount?: number; currency?: string }
}

export async function POST(request: Request) {
  const token = process.env.SQUARE_ACCESS_TOKEN
  if (!token) {
    return NextResponse.json({ error: "Square の環境変数が未設定です" }, { status: 500 })
  }

  const { amount, sinceIso } = (await request.json()) as {
    amount: number
    sinceIso: string
  }
  if (typeof amount !== "number" || !sinceIso) {
    return NextResponse.json({ error: "amount と sinceIso が必要です" }, { status: 400 })
  }

  const url =
    `${SQUARE_BASE}/v2/payments` +
    `?begin_time=${encodeURIComponent(sinceIso)}` +
    `&sort_order=DESC&limit=100`

  const res = await fetch(url, {
    headers: {
      "Square-Version": SQUARE_VERSION,
      "Authorization": `Bearer ${token}`,
    },
    // 復旧判断に使うため常に最新を取りに行く
    cache: "no-store",
  })

  const data = (await res.json()) as { payments?: SquarePayment[]; errors?: { detail: string }[] }
  if (!res.ok) {
    return NextResponse.json(
      { error: data.errors?.[0]?.detail ?? "Square 決済履歴の取得に失敗しました" },
      { status: 500 },
    )
  }

  // 同額・完了済みのものだけを候補にする（JPY は補助単位が無いので amount はそのまま円）
  const matches = (data.payments ?? [])
    .filter((p) => {
      const done = p.status === "COMPLETED" || p.status === "APPROVED"
      return done && p.amount_money?.amount === amount
    })
    .map((p) => ({
      id: p.id,
      amount: p.amount_money?.amount ?? 0,
      createdAt: p.created_at ?? null,
      status: p.status ?? "",
    }))

  return NextResponse.json({ matches })
}
