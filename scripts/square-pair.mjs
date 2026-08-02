// Squareターミナルのペアリング用スクリプト
// 使い方: node scripts/square-pair.mjs <店舗名>
//   店舗名: meguro | akabane | hamamatsucho
// デバイスコードを発行して表示し、ターミナル実機でのサインインを待って
// device_id と .env.local に追加する行を出力する。
// 注意: コードの有効期限は発行から5分。実機を手元に用意してから実行すること。

import { readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"

const STORES = {
  meguro: { storeId: 1, locationId: "LY8T4KP4K580P", label: "目黒店" },
  akabane: { storeId: 4, locationId: "L2Y2P14P349AY", label: "赤羽店" },
  hamamatsucho: { storeId: 5, locationId: "LFKJ7TSA556JG", label: "浜松町店" },
}

const store = STORES[process.argv[2]]
if (!store) {
  console.error("使い方: node scripts/square-pair.mjs <meguro|akabane|hamamatsucho>")
  process.exit(1)
}

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
)

const BASE = env.SQUARE_ENVIRONMENT === "sandbox"
  ? "https://connect.squareupsandbox.com"
  : "https://connect.squareup.com"

const headers = {
  "Square-Version": "2024-01-18",
  "Authorization": `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
  "Content-Type": "application/json",
}

const createRes = await fetch(`${BASE}/v2/devices/codes`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    idempotency_key: randomUUID(),
    device_code: {
      name: store.label,
      product_type: "TERMINAL_API",
      location_id: store.locationId,
    },
  }),
})
const createData = await createRes.json()
if (!createRes.ok || !createData.device_code) {
  console.error("デバイスコード発行失敗:", JSON.stringify(createData.errors ?? createData))
  process.exit(1)
}

const { id, code } = createData.device_code
console.log(`\n${store.label} のデバイスコード: ${code}`)
console.log("ターミナル実機の「設定 → デバイスコードでサインイン」に5分以内に入力してください。")
console.log("ペアリング完了を待機中...\n")

for (;;) {
  await new Promise((r) => setTimeout(r, 3000))
  const res = await fetch(`${BASE}/v2/devices/codes/${id}`, { headers })
  const data = await res.json()
  const dc = data.device_code
  if (!res.ok || !dc) {
    console.error("ステータス取得失敗:", JSON.stringify(data.errors ?? data))
    process.exit(1)
  }
  if (dc.status === "PAIRED") {
    console.log(`ペアリング完了! device_id: ${dc.device_id}`)
    console.log(`\n.env.local に以下を追加してください:`)
    console.log(`SQUARE_DEVICE_ID_${store.storeId}=${dc.device_id}`)
    process.exit(0)
  }
  if (dc.status === "EXPIRED") {
    console.error("コードの有効期限が切れました。もう一度実行してください。")
    process.exit(1)
  }
  process.stdout.write(`  status: ${dc.status}\r`)
}
