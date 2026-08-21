// タブ間の同期。
// Square アプリは決済後にコールバックURLを開いて戻ってくるが、Safari はこれを
// 別タブで開くことがある。すると同じ店舗の POS が複数タブで同時に生き、
// 片方で会計しても、もう片方は会計前の伝票を持ったままになる。
// その古いタブから同じ伝票をもう一度会計できてしまい、同額の会計が二重に台帳へ残る。
//
// 台帳を動かしたタブが合図を出し、受け取ったタブは DB から取り直して追いつく。

const CHANNEL_NAME = "pos_sync"
// BroadcastChannel が使えない環境（古い iOS Safari）向けのフォールバック。
// localStorage への書き込みは他タブに storage イベントとして届く
const FALLBACK_KEY = "pos_sync_ping"

interface PosSyncPing {
  storeId: number
  /** 送信元タブの識別子。自分が出した合図で自分が再取得しないようにする */
  tabId: string
  at: number
}

const TAB_ID = Math.random().toString(36).slice(2)

/** 台帳を更新したことを他タブへ知らせる。DBへ書き終えてから呼ぶこと */
export function broadcastPosChange(storeId: number): void {
  const ping: PosSyncPing = { storeId, tabId: TAB_ID, at: Date.now() }
  // 通知できなくても会計自体は成立しているため、失敗は握り潰して先へ進む
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(CHANNEL_NAME)
      channel.postMessage(ping)
      channel.close()
    }
  } catch (e) {
    console.error("[sync]broadcast:", e)
  }
  try {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(ping))
  } catch (e) {
    console.error("[sync]fallback:", e)
  }
}

/** 他タブの更新を受け取る。戻り値を呼ぶと購読を解除する */
export function subscribePosChanges(storeId: number, onChange: () => void): () => void {
  // BroadcastChannel とフォールバックの両方が届く環境では二重に発火するため、
  // 同じ合図は一度しか処理しない
  let lastSeenAt = 0
  const handle = (raw: unknown) => {
    const ping = raw as PosSyncPing | null
    if (!ping || typeof ping.at !== "number") return
    if (ping.storeId !== storeId || ping.tabId === TAB_ID) return
    if (ping.at <= lastSeenAt) return
    lastSeenAt = ping.at
    onChange()
  }

  let channel: BroadcastChannel | null = null
  try {
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(CHANNEL_NAME)
      channel.onmessage = (e) => handle(e.data)
    }
  } catch (e) {
    console.error("[sync]subscribe:", e)
    channel = null
  }

  const onStorage = (e: StorageEvent) => {
    if (e.key !== FALLBACK_KEY || !e.newValue) return
    try {
      handle(JSON.parse(e.newValue))
    } catch {
      // 壊れた合図は無視する
    }
  }
  window.addEventListener("storage", onStorage)

  return () => {
    window.removeEventListener("storage", onStorage)
    channel?.close()
  }
}
