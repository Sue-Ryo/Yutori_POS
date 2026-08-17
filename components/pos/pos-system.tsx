"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import type {
  ServiceBlock,
  BlockSession,
  OrderItem,
  LayoutElement,
  BusinessSettings,
  Payment,
  CheckoutData,
  Product,
  Coupon,
  DailyExpense,
} from "@/lib/pos-types"
import {
  initialBlocks,
  initialLayoutElements,
  initialSessions,
  initialPayments,
  initialSettings,
  products as initialProducts,
  coupons as initialCoupons,
  getBusinessDate,
} from "@/lib/pos-store"
import {
  storageKeys,
  loadList,
  saveList,
  loadObject,
  saveObject,
  revivers,
} from "@/lib/pos-storage"
import { supabase } from "@/lib/supabase"
import { fetchProducts, createProduct, updateProduct, deleteProduct, updateProductOrders } from "@/lib/api/products"
import { fetchBlocks, upsertBlocks, syncBlocks } from "@/lib/api/blocks"
import { fetchSessions, upsertSessions } from "@/lib/api/sessions"
import { changedOrders } from "@/lib/product-order"
import { fetchPayments, upsertPayments, cancelPaymentDb } from "@/lib/api/payments-db"
import { fetchSettings, upsertSettings } from "@/lib/api/settings-db"
import { fetchCoupons, insertCoupon, updateCouponDb, deleteCoupon } from "@/lib/api/coupons-db"
import { fetchLayoutElements, upsertLayoutElements } from "@/lib/api/layout-db"
import { fetchExpenses, upsertExpense } from "@/lib/api/expenses-db"
import { FloorMap } from "./floor-map"
import { OrderSidebar } from "./order-sidebar"
import {
  parseSquareCallback,
  loadPendingSquareCheckout,
  clearPendingSquareCheckout,
  startSquarePosPayment,
  type PendingSquareCheckout,
} from "@/lib/square-pos-link"
import { loadSplitPlan, saveSplitPlan, clearSplitPlan } from "@/lib/split-checkout"
import { LayoutEditor } from "./layout-editor"
import { AdminReport } from "./admin-report"
import { Button } from "@/components/ui/button"
import { LayoutGrid, Edit3, BarChart3, UtensilsCrossed, RefreshCw, Link2, ArrowRightLeft } from "lucide-react"

type Tab = "map" | "editor" | "report"

// 下膳（空席化）時に持ち越してはいけない接客情報を落とす。
// 会計時の顧客名は payments 側へ別途コピー済みのため、売上履歴には影響しない。
const stripGuestInfo = (s: BlockSession): BlockSession => ({
  ...s,
  customerName: undefined,
  note: undefined,
  // happy_hour / is_new_customer は NOT NULL 相当で常に boolean が返るため、
  // undefined ではなく false に揃える
  happyHour: false,
  isNewCustomer: false,
})
const hasGuestInfo = (s: BlockSession) =>
  !!s.customerName || !!s.note || !!s.happyHour || !!s.isNewCustomer

export function POSSystem({ storeId }: { storeId: number }) {
  const [activeTab, setActiveTab] = useState<Tab>("map")
  const initializedRef = useRef(false)

  const [blocks, setBlocks] = useState<ServiceBlock[]>(initialBlocks)
  const [layoutElements, setLayoutElements] = useState<LayoutElement[]>(initialLayoutElements)
  const [sessions, setSessions] = useState<BlockSession[]>(initialSessions)
  const [payments, setPayments] = useState<Payment[]>(initialPayments)
  const [settings, setSettings] = useState<BusinessSettings>(initialSettings)
  const [products, setProducts] = useState<Product[]>(initialProducts)
  const [coupons, setCoupons] = useState<Coupon[]>(initialCoupons)
  const [expenses, setExpenses] = useState<DailyExpense[]>([])
  const [dbLoading, setDbLoading] = useState(false)
  // DBからの初回読み込みが完了したか（未完了時は sessions がデモ初期値のため判定に使えない）
  const [dbLoaded, setDbLoaded] = useState(false)
  const [dbError, setDbError] = useState<string | null>(null)
  // DB / localStorage から取り込んだ配列・オブジェクトそのものに印を付ける。
  // 印の付いた値が state に入っているうちは外部由来なのでDBへ書き戻さない。
  // （時間ベースのガードだと、DB読込直後に走るSquare復帰後の会計処理まで握り潰してしまい、
  //   席ステータス「会計済」がDBへ届かなくなる）
  const fromStoreRef = useRef(new WeakSet<object>())
  const markFromStore = useCallback(<T extends object>(value: T): T => {
    fromStoreRef.current.add(value)
    return value
  }, [])
  // 直近のローカル更新時刻。これより前に開始した fetch の結果は古いので取り込まない
  const lastLocalWriteRef = useRef(0)
  const paymentsRef = useRef<Payment[]>([])

  // Supabase から全データを取得
  const loadAllFromDB = useCallback(async () => {
    setDbLoading(true)
    // fetch 中にローカル更新（会計など）が入った場合、その結果で上書きしないための基準時刻
    const loadStartedAt = Date.now()
    let shouldMigratePayments = false
    try {
      const [
        dbBlocks, dbSessions, dbPayments,
        dbSettings, dbCoupons, dbElements, dbProducts, dbExpenses,
      ] = await Promise.all([
        fetchBlocks(storeId).catch((e) => { console.error("[DB]blocks fetch:", e); return null }),
        fetchSessions(storeId).catch((e) => { console.error("[DB]sessions fetch:", e); return null }),
        fetchPayments(storeId).catch((e) => { console.error("[DB]payments fetch:", e); return null }),
        fetchSettings(storeId).catch((e) => { console.error("[DB]settings fetch:", e); return null }),
        fetchCoupons(storeId).catch((e) => { console.error("[DB]coupons fetch:", e); return null }),
        fetchLayoutElements(storeId).catch((e) => { console.error("[DB]layout fetch:", e); return null }),
        fetchProducts(storeId).catch((e) => { console.error("[DB]products fetch:", e); return null }),
        fetchExpenses(storeId).catch((e) => { console.error("[DB]expenses fetch:", e); return null }),
      ])
      // fetch 中にローカル更新が入っていたら、席・伝票・会計は古い結果で上書きしない
      const staleForLocalWrites = lastLocalWriteRef.current >= loadStartedAt
      if (staleForLocalWrites) {
        console.log("[POSSystem] 読込中にローカル更新あり → 席/伝票/会計の取り込みをスキップ")
      }
      if (dbBlocks !== null && !staleForLocalWrites) setBlocks(markFromStore(dbBlocks))
      if (dbSessions !== null && !staleForLocalWrites) setSessions(dbSessions)
      // 空席なのに終了していないセッション（孤児）を掃除する。
      // 席を開くまで残り続け、次の客に顧客名・HH・入店時間が引き継がれてしまうため。
      // 未会計のオーダーが残っているものは席のステータス側が壊れている可能性があるので触らない。
      if (dbSessions !== null && dbBlocks !== null && !staleForLocalWrites) {
        const statusById = new Map(dbBlocks.map((b) => [b.id, b.status]))
        const orphans = dbSessions.filter(
          (s) =>
            !s.endedAt &&
            statusById.get(s.blockId) === "empty" &&
            !s.orderItems.some((i) => !i.isPaid),
        )
        if (orphans.length > 0) {
          const sweptAt = new Date()
          const swept = orphans.map((s) => stripGuestInfo({ ...s, endedAt: sweptAt }))
          const sweptById = new Map(swept.map((s) => [s.id, s]))
          setSessions((prev) => prev.map((s) => sweptById.get(s.id) ?? s))
          lastLocalWriteRef.current = Date.now()
          upsertSessions(swept, storeId).catch((e) => console.error("[DB]sessions orphan sweep:", e))
          console.log("[POSSystem] 空席に残っていたセッションを終了:", orphans.length, "件")
        }
      }
      if (dbPayments !== null && !staleForLocalWrites) {
        if (dbPayments.length > 0) {
          // DB にデータあり → DB を正とする
          setPayments(dbPayments)
        } else {
          // DB が空 → localStorage のデータを保持し、後で DB へ移行する
          shouldMigratePayments = true
        }
      }
      if (dbSettings !== null) setSettings(markFromStore(dbSettings))
      if (dbCoupons !== null) setCoupons(dbCoupons)
      if (dbElements !== null) setLayoutElements(markFromStore(dbElements))
      if (dbProducts !== null) setProducts(dbProducts)
      if (dbExpenses !== null) setExpenses(dbExpenses)
      console.log("[POSSystem] DB読み込み完了")
    } catch (err) {
      console.error("DB読み込みエラー:", err)
      setDbError("データの取得に失敗しました（ローカルデータを使用）")
    } finally {
      setDbLoading(false)
      setDbLoaded(true)
      // localStorage にあった会計データを DB へ移行
      if (shouldMigratePayments && paymentsRef.current.length > 0) {
        console.log("[DB]payments migrate:", paymentsRef.current.length, "件をDBへ書き込み")
        upsertPayments(paymentsRef.current, storeId).catch((e) => console.error("[DB]payments migrate:", e))
      }
    }
  }, [])

  useEffect(() => {
    loadAllFromDB()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // タブ復帰時にDBから再取得（realtime漏れのフォールバック）
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") loadAllFromDB()
    }
    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 他端末の変更をリアルタイム受信
  useEffect(() => {
    // 取得中にローカル更新（会計など）が入った場合、古い結果で上書きしない
    const isStale = (startedAt: number) => lastLocalWriteRef.current >= startedAt
    const channel = supabase
      .channel("pos_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "blocks" }, () => {
        const startedAt = Date.now()
        fetchBlocks(storeId).then((data) => {
          if (isStale(startedAt)) return
          setBlocks(markFromStore(data))
        }).catch((e) => console.error("[RT]blocks:", e))
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "sessions" }, () => {
        const startedAt = Date.now()
        fetchSessions(storeId).then((data) => {
          if (isStale(startedAt)) return
          setSessions(data)
        }).catch((e) => console.error("[RT]sessions:", e))
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, () => {
        const startedAt = Date.now()
        fetchPayments(storeId).then((data) => {
          if (isStale(startedAt)) return
          setPayments(data)
        }).catch((e) => console.error("[RT]payments:", e))
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "layout_elements" }, () => {
        fetchLayoutElements(storeId)
          .then((data) => setLayoutElements(markFromStore(data)))
          .catch((e) => console.error("[RT]layout_elements:", e))
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "stores" }, () => {
        fetchSettings(storeId).then((data) => {
          if (data) setSettings(markFromStore(data))
        }).catch((e) => console.error("[RT]stores:", e))
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "coupons" }, () => {
        fetchCoupons(storeId).then(setCoupons).catch((e) => console.error("[RT]coupons:", e))
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, () => {
        fetchProducts(storeId).then(setProducts).catch((e) => console.error("[RT]products:", e))
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "daily_expenses" }, () => {
        fetchExpenses(storeId).then(setExpenses).catch((e) => console.error("[RT]daily_expenses:", e))
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // paymentsRef を最新 state と常に同期（loadAllFromDB 内で移行書き込み用）
  useEffect(() => { paymentsRef.current = payments }, [payments])

  // 状態変化時に localStorage へ保存（初期ロード後のみ）
  // ※ このsave effectsは必ずloadEffectより前に定義すること（effect実行順序に依存）
  const KEYS = storageKeys(storeId)
  useEffect(() => { if (initializedRef.current) saveList(KEYS.blocks, blocks) }, [blocks])
  useEffect(() => { if (initializedRef.current) saveList(KEYS.layoutElements, layoutElements) }, [layoutElements])
  useEffect(() => { if (initializedRef.current) saveList(KEYS.sessions, sessions) }, [sessions])
  useEffect(() => { if (initializedRef.current) saveList(KEYS.payments, payments) }, [payments])
  useEffect(() => { if (initializedRef.current) saveObject(KEYS.settings, settings) }, [settings])
  useEffect(() => { if (initializedRef.current) saveList(KEYS.coupons, coupons) }, [coupons])

  // 状態変化時に Supabase へ同期（DB/localStorage から取り込んだ値そのものは書き戻さない）
  useEffect(() => {
    if (!initializedRef.current || fromStoreRef.current.has(blocks)) return
    lastLocalWriteRef.current = Date.now()
    upsertBlocks(blocks, storeId).catch((e) => console.error("[DB]blocks:", e))
  }, [blocks])
  useEffect(() => {
    if (!initializedRef.current || fromStoreRef.current.has(layoutElements)) return
    upsertLayoutElements(layoutElements, storeId).catch((e) => console.error("[DB]layout:", e))
  }, [layoutElements])
  useEffect(() => {
    if (!initializedRef.current || fromStoreRef.current.has(settings)) return
    upsertSettings(storeId, settings).catch((e) => console.error("[DB]settings:", e))
  }, [settings])

  // localStorage から読み込む（クライアントサイドのみ・save effectsより後に定義すること）
  useEffect(() => {
    const savedBlocks = loadList(KEYS.blocks, revivers.reviveBlock)
    const savedElements = loadList(KEYS.layoutElements, (r) => r as unknown as LayoutElement)
    const savedSessions = loadList(KEYS.sessions, revivers.reviveSession)
    const savedPayments = loadList(KEYS.payments, revivers.revivePayment)
    const savedSettings = loadObject<BusinessSettings>(KEYS.settings)
    const savedCoupons = loadList(KEYS.coupons, (r) => r as unknown as Coupon)
    // 復元値はDBから読んだ値と同じく「外部由来」なのでDBへ書き戻さない
    if (savedBlocks !== null) setBlocks(markFromStore(savedBlocks))
    if (savedElements !== null) setLayoutElements(markFromStore(savedElements))
    if (savedSessions !== null) setSessions(savedSessions)
    if (savedPayments !== null) setPayments(savedPayments)
    if (savedSettings !== null) setSettings(markFromStore(savedSettings))
    if (savedCoupons !== null) setCoupons(savedCoupons)
    initializedRef.current = true
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // セッション未作成時のローカルキャッシュ（初回オーダー時にセッションへ統合）
  const [happyHourByBlock, setHappyHourByBlock] = useState<Record<string, boolean>>({})
  const [newCustomerByBlock, setNewCustomerByBlock] = useState<Record<string, boolean>>({})
  const [customerNames, setCustomerNames] = useState<Record<string, string>>({})
  const [linkMode, setLinkMode] = useState(false)
  const [linkSelection, setLinkSelection] = useState<string[]>([])
  const [moveMode, setMoveMode] = useState(false)
  const [moveSource, setMoveSource] = useState<string | null>(null)
  // 連結席はグループ全体を移すため、移動先は席数ぶん選ぶ
  const [moveDests, setMoveDests] = useState<string[]>([])
  // 分割会計の1回分が終わったときの合図。nonce を増やして次の回のモーダルを開かせる
  const [resumeSplit, setResumeSplit] = useState<{ sessionId: string; nonce: number } | null>(null)
  const handleResumeSplitHandled = useCallback(() => setResumeSplit(null), [])

  // 移動元の席。連結中の席を選んだ場合はグループ全体（プライマリ + 連結先）が対象になる
  const moveSourceSession = moveSource
    ? sessions.find(
        (s) => !s.endedAt && (s.blockId === moveSource || (s.linkedBlockIds ?? []).includes(moveSource)),
      ) ?? null
    : null
  const moveSourceBlockIds = moveSourceSession
    ? [moveSourceSession.blockId, ...(moveSourceSession.linkedBlockIds ?? [])]
    : moveSource
    ? [moveSource]
    : []

  const selectedBlock = selectedBlockId ? blocks.find((b) => b.id === selectedBlockId) ?? null : null
  const currentSession = selectedBlockId
    ? sessions.find((s) => s.blockId === selectedBlockId && !s.endedAt) ?? null
    : null

  // セッションがあればセッション値を優先、なければローカルキャッシュを使用
  const currentHappyHour = currentSession?.happyHour ?? (selectedBlockId ? (happyHourByBlock[selectedBlockId] ?? false) : false)
  const handleHappyHourChange = useCallback((value: boolean) => {
    if (!selectedBlockId) return
    setHappyHourByBlock((prev) => ({ ...prev, [selectedBlockId]: value }))
    if (currentSession) {
      const updated = { ...currentSession, happyHour: value }
      setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
      lastLocalWriteRef.current = Date.now()
      upsertSessions([updated], storeId).catch((e) => console.error("[DB]sessions happyHour:", e))
    }
  }, [selectedBlockId, currentSession])

  const currentIsNewCustomer = currentSession?.isNewCustomer ?? (selectedBlockId ? (newCustomerByBlock[selectedBlockId] ?? false) : false)
  const handleIsNewCustomerChange = useCallback((value: boolean) => {
    if (!selectedBlockId) return
    setNewCustomerByBlock((prev) => ({ ...prev, [selectedBlockId]: value }))
    if (currentSession) {
      const updated = { ...currentSession, isNewCustomer: value }
      setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
      lastLocalWriteRef.current = Date.now()
      upsertSessions([updated], storeId).catch((e) => console.error("[DB]sessions newCustomer:", e))
    }
  }, [selectedBlockId, currentSession])

  const currentCustomerName = currentSession?.customerName ?? (selectedBlockId ? (customerNames[selectedBlockId] ?? "") : "")
  const handleCustomerNameChange = useCallback((name: string) => {
    if (!selectedBlockId) return
    setCustomerNames((prev) => ({ ...prev, [selectedBlockId]: name }))
    if (currentSession) {
      const updated = { ...currentSession, customerName: name }
      setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
      lastLocalWriteRef.current = Date.now()
      upsertSessions([updated], storeId).catch((e) => console.error("[DB]sessions customerName:", e))
    }
  }, [selectedBlockId, currentSession])

  const handleBlockClick = useCallback((blockId: string) => {
    // 連結先（サブ）ブロックをクリックした場合はプライマリブロックのセッションを開く
    const ownerSession = sessions.find(
      (s) => !s.endedAt && (s.linkedBlockIds ?? []).includes(blockId)
    )
    const targetBlockId = ownerSession ? ownerSession.blockId : blockId

    // 空席なのに終了していないセッションが残っていると、入店時間や顧客名が
    // 次の客に引き継がれてしまう。開いた時点で終了させて掃除する
    const target = blocks.find((b) => b.id === targetBlockId)
    const ghostSession = sessions.find(
      (s) => !s.endedAt && s.blockId === targetBlockId,
    )
    if (target?.status === "empty" && ghostSession) {
      const endedGhost = stripGuestInfo({ ...ghostSession, endedAt: new Date() })
      setSessions((prev) => prev.map((s) => (s.id === endedGhost.id ? endedGhost : s)))
      lastLocalWriteRef.current = Date.now()
      upsertSessions([endedGhost], storeId).catch((e) => console.error("[DB]sessions ghost clear:", e))
      setCustomerNames((prev) => {
        const next = { ...prev }
        delete next[targetBlockId]
        return next
      })
      setHappyHourByBlock((prev) => {
        const next = { ...prev }
        delete next[targetBlockId]
        return next
      })
      setNewCustomerByBlock((prev) => {
        const next = { ...prev }
        delete next[targetBlockId]
        return next
      })
    }

    setSelectedBlockId(targetBlockId)
    setSidebarOpen(true)
  }, [sessions, blocks])

  const handleCloseSidebar = useCallback(() => {
    setSidebarOpen(false)
    setSelectedBlockId(null)
  }, [])

  const bussingById = useCallback((blockId: string) => {
    const now = new Date()
    // この席に関係するセッションを集める（同一blockIdのセッションは過去分含め複数存在する）
    const related = sessions.filter(
      (s) => s.blockId === blockId || (s.linkedBlockIds ?? []).includes(blockId),
    )
    // endedAt なしのゴーストセッション（DB 未同期の古いセッション対策）。
    // 複数残っていることがあるため find ではなく全件を対象にする。
    const ghostSessions = related.filter((s) => !s.endedAt)
    const latestEnded = related
      .filter((s) => s.endedAt)
      .sort((a, b) => b.endedAt!.getTime() - a.endedAt!.getTime())[0]

    // 現在の連結構成はアクティブなセッションが持つため、あればそちらを優先する。
    const linkedFromGhosts = ghostSessions.flatMap((s) => [s.blockId, ...(s.linkedBlockIds ?? [])])
    // アクティブ側に連結情報が無いときは、直前に会計されたグループの構成で補う。
    // ただし終了済みセッションは前の組の連結情報であることがあり、別の組を巻き込んで
    // 空席化しかねないため、まだ会計済み(checked_out)のままの席だけを対象にする。
    const blockStatusById = new Map(blocks.map((b) => [b.id, b.status]))
    const linkedFromEnded =
      latestEnded && !ghostSessions.some((s) => s.linkedBlockIds?.length)
        ? [latestEnded.blockId, ...(latestEnded.linkedBlockIds ?? [])].filter(
            (id) => id === blockId || blockStatusById.get(id) === "checked_out",
          )
        : []
    const allBlockIds = Array.from(
      new Set([blockId, ...linkedFromGhosts, ...linkedFromEnded]),
    )

    // ゴーストは終了させ、終了済みセッションからも接客情報を落とす。
    // endedAt の同期に失敗した場合でも、次の客に顧客名・備考・HH が復活しないようにする。
    const toClean = [
      ...ghostSessions,
      ...(latestEnded && hasGuestInfo(latestEnded) ? [latestEnded] : []),
    ]
    if (toClean.length > 0) {
      const cleaned = toClean.map((s) => stripGuestInfo({ ...s, endedAt: s.endedAt ?? now }))
      const cleanedById = new Map(cleaned.map((s) => [s.id, s]))
      setSessions((prev) => prev.map((s) => cleanedById.get(s.id) ?? s))
      // 掃除の直後に再取得が走ると、DB 反映前の古い行で巻き戻されるため印を付ける
      lastLocalWriteRef.current = Date.now()
      upsertSessions(cleaned, storeId).catch((e) => console.error("[DB]sessions bussing:", e))
    }

    setBlocks((prev) =>
      prev.map((b) =>
        allBlockIds.includes(b.id)
          ? { ...b, status: "empty", startedAt: undefined, checkedOutAt: undefined }
          : b,
      ),
    )

    // 空席化した席の分割会計は途中でも無効になるため進捗を捨てる
    const plan = loadSplitPlan(storeId)
    if (plan && allBlockIds.includes(plan.blockId)) clearSplitPlan(storeId)

    // ローカルキャッシュ（顧客名・ハッピーアワー・新規客）も空席化で破棄する
    setCustomerNames((prev) => {
      const next = { ...prev }
      allBlockIds.forEach((id) => delete next[id])
      return next
    })
    setHappyHourByBlock((prev) => {
      const next = { ...prev }
      allBlockIds.forEach((id) => delete next[id])
      return next
    })
    setNewCustomerByBlock((prev) => {
      const next = { ...prev }
      allBlockIds.forEach((id) => delete next[id])
      return next
    })
  }, [sessions, blocks])

  const handleBussingComplete = useCallback(() => {
    if (!selectedBlockId) return
    bussingById(selectedBlockId)
    handleCloseSidebar()
  }, [selectedBlockId, bussingById, handleCloseSidebar])

  const handleUpdateSession = useCallback(
    (updatedSession: BlockSession) => {
      // ローカルキャッシュの customerName / happyHour を新規セッションに統合
      const sessionWithCache = sessions.find((s) => s.id === updatedSession.id)
        ? updatedSession
        : {
            ...updatedSession,
            customerName: updatedSession.customerName ?? customerNames[updatedSession.blockId] ?? undefined,
            happyHour: updatedSession.happyHour ?? happyHourByBlock[updatedSession.blockId] ?? undefined,
            isNewCustomer:
              updatedSession.isNewCustomer ?? newCustomerByBlock[updatedSession.blockId] ?? undefined,
          }
      const unpaidItems = updatedSession.orderItems.filter((i) => !i.isPaid)
      const hasItems = unpaidItems.length > 0
      const status = hasItems ? "occupied" : "empty"
      const totalQty = unpaidItems.reduce((sum, i) => sum + i.quantity, 0)
      const allBlockIds = [updatedSession.blockId, ...(updatedSession.linkedBlockIds ?? [])]

      // 未会計オーダーが無くなった席は空席になるため、その来店も終了として扱う。
      // セッションを開いたまま残すと、入店時間や顧客名が次の客に引き継がれてしまう。
      const sessionToSave = hasItems
        ? sessionWithCache
        : stripGuestInfo({ ...sessionWithCache, endedAt: sessionWithCache.endedAt ?? new Date() })

      setSessions((prev) => {
        const exists = prev.find((s) => s.id === sessionToSave.id)
        if (exists) {
          return prev.map((s) => (s.id === sessionToSave.id ? sessionToSave : s))
        }
        return [...prev, sessionToSave]
      })
      // sessions は書き戻し用の useEffect を持たないため直接同期する
      lastLocalWriteRef.current = Date.now()
      upsertSessions([sessionToSave], storeId).catch((e) => console.error("[DB]sessions update:", e))

      // プライマリ + 連結ブロック全てのステータスを更新
      setBlocks((prev) =>
        prev.map((b) => {
          if (!allBlockIds.includes(b.id)) return b
          if (!hasItems) return { ...b, status: "empty", startedAt: undefined, checkedOutAt: undefined }
          // 累計3オーダーに達したタイミングで初めてタイマー開始
          const startedAt = totalQty >= 3 ? (b.startedAt ?? new Date()) : b.startedAt
          return { ...b, status, startedAt }
        })
      )

      // 空席になったら接客情報のローカルキャッシュも破棄する
      if (!hasItems) {
        setCustomerNames((prev) => {
          const next = { ...prev }
          allBlockIds.forEach((id) => delete next[id])
          return next
        })
        setHappyHourByBlock((prev) => {
          const next = { ...prev }
          allBlockIds.forEach((id) => delete next[id])
          return next
        })
        setNewCustomerByBlock((prev) => {
          const next = { ...prev }
          allBlockIds.forEach((id) => delete next[id])
          return next
        })
      }
    },
    [sessions, customerNames, happyHourByBlock, newCustomerByBlock]
  )

  const handleCheckout = useCallback(
    (sessionId: string, data: CheckoutData) => {
      const session = sessions.find((s) => s.id === sessionId)
      if (!session) return

      const now = new Date()
      const businessDate = getBusinessDate(now, settings.businessDayStartTime)

      // 対象アイテムの特定
      const targetItemIds =
        data.paidItemIds.length > 0
          ? data.paidItemIds
          : session.orderItems.filter((i) => !i.isPaid).map((i) => i.id)

      // Payment 作成
      const newPayment: Payment = {
        id: `pay-${Date.now()}`,
        sessionId,
        blockId: session.blockId,
        paymentDatetime: now,
        businessDate,
        subtotalAmount: data.totalAmount - data.taxAmount + data.discountAmount,
        discountAmount: data.discountAmount,
        taxAmount: data.taxAmount,
        totalAmount: data.totalAmount,
        cashAmount: data.cashAmount,
        cashlessAmount: data.cashlessAmount,
        guestCount: data.guestCount,
        couponId: data.couponId,
        customerName: data.customerName,
        sessionStartedAt: session.startedAt,
        squarePaymentId: data.squarePaymentId,
        // 新規客の集計用。Square 復帰時は CheckoutData 側の値が正
        isNewCustomer: data.isNewCustomer ?? session.isNewCustomer ?? false,
        // 下膳で session.happyHour は落ちるため、会計時点の適用有無をここに残す
        happyHour: session.happyHour ?? false,
      }
      // Square復帰直後はDB再読込と競合しうるため、ローカル更新時刻を先に記録して
      // 古い fetch 結果が会計後の状態を上書きしないようにする
      lastLocalWriteRef.current = Date.now()
      setPayments((prev) => [newPayment, ...prev])
      upsertPayments([newPayment], storeId).catch((e) => console.error("[DB]payments checkout:", e))

      // セッションの明細を支払済に更新（paymentId を紐付け）。
      // 同じ商品をまとめた明細の一部だけを支払う場合は、支払い分と残り分に分割する。
      const paidQuantities = data.paidItemQuantities ?? {}
      const updatedItems = session.orderItems.flatMap<OrderItem>((i) => {
        if (i.isPaid || !targetItemIds.includes(i.id)) return [i]
        const payQty = paidQuantities[i.id] ?? i.quantity
        if (payQty <= 0) return [i]
        if (payQty >= i.quantity) {
          return [{ ...i, isPaid: true, paidAt: now, paymentId: newPayment.id }]
        }
        const remainQty = i.quantity - payQty
        return [
          {
            ...i,
            id: `i-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            quantity: payQty,
            subtotal: i.price * payQty,
            isPaid: true,
            paidAt: now,
            paymentId: newPayment.id,
          },
          { ...i, quantity: remainQty, subtotal: i.price * remainQty },
        ]
      })
      const allPaid = updatedItems.every((i) => i.isPaid)
      const updatedSession: BlockSession = {
        ...session,
        orderItems: updatedItems,
        guestCount: data.guestCount,
        endedAt: allPaid ? now : undefined,
      }
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? updatedSession : s)))
      // sessions は書き戻し用の useEffect を持たないため直接同期する（endedAt 欠落防止）
      upsertSessions([updatedSession], storeId).catch((e) => console.error("[DB]sessions checkout:", e))

      // プライマリ + 連結ブロック全て更新
      const allBlockIds = [session.blockId, ...(session.linkedBlockIds ?? [])]
      // 一部会計済みの場合はステータス再計算
      const remaining = updatedItems.filter((i) => !i.isPaid)
      setBlocks((prev) =>
        prev.map((b) => {
          if (!allBlockIds.includes(b.id)) return b
          if (allPaid) {
            return { ...b, status: "checked_out", checkedOutAt: now }
          }
          if (remaining.length > 0) return { ...b, status: "occupied" }
          return { ...b, status: "empty", startedAt: undefined, checkedOutAt: undefined }
        })
      )

      // 分割会計（個別会計）の進捗を進める。
      // Square 経由だと1回ごとにページが再読込されるため、進捗は localStorage 側が持つ。
      const plan = loadSplitPlan(storeId)
      const continuesSplit = !!plan && plan.sessionId === sessionId && !allPaid
      if (plan && plan.sessionId === sessionId) {
        if (continuesSplit) {
          saveSplitPlan(storeId, { ...plan, completedRounds: plan.completedRounds + 1 })
        } else {
          clearSplitPlan(storeId)
        }
      }

      if (continuesSplit) {
        // 次の回をすぐ続けられるよう、伝票を開いたままにして合図を送る
        setSelectedBlockId(session.blockId)
        setSidebarOpen(true)
        setResumeSplit((prev) => ({ sessionId, nonce: (prev?.nonce ?? 0) + 1 }))
      } else {
        handleCloseSidebar()
      }
    },
    [sessions, settings.businessDayStartTime, handleCloseSidebar]
  )

  // ── Square 決済の取りこぼし復旧 ──────────────────────────────────
  // 決済後にブラウザへ戻る前に端末を閉じるとコールバックが来ず、会計が記録されない。
  // 復帰時に未処理の保留会計を拾い、Square の決済履歴と照合して確認する。
  const [squareRecovery, setSquareRecovery] = useState<{
    pending: PendingSquareCheckout
    blockName: string
    lookup: "loading" | "found" | "notfound" | "error"
    transactionId?: string
    lookupError?: string
  } | null>(null)

  const startSquareRecovery = useCallback(async (pending: PendingSquareCheckout) => {
    const session = sessions.find((s) => s.id === pending.sessionId)
    const block = blocks.find((b) => b.id === session?.blockId)
    setSquareRecovery({ pending, blockName: block?.name ?? "不明な席", lookup: "loading" })
    try {
      const res = await fetch("/api/square/payments/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: pending.amount ?? pending.data.totalAmount,
          // 起動直前の時刻から少し余裕を持って検索する
          sinceIso: new Date(pending.createdAt - 5 * 60 * 1000).toISOString(),
        }),
      })
      const data = await res.json() as {
        matches?: { id: string; createdAt: string | null }[]
        error?: string
      }
      if (!res.ok) throw new Error(data.error ?? "照会に失敗しました")
      const match = data.matches?.[0]
      setSquareRecovery((prev) =>
        prev && {
          ...prev,
          lookup: match ? "found" : "notfound",
          transactionId: match?.id,
        },
      )
    } catch (e) {
      setSquareRecovery((prev) =>
        prev && { ...prev, lookup: "error", lookupError: e instanceof Error ? e.message : String(e) },
      )
    }
  }, [sessions, blocks])

  // Square POSアプリからの決済結果コールバック処理（モバイルWeb連携）
  const squareCallbackDoneRef = useRef(false)
  useEffect(() => {
    if (squareCallbackDoneRef.current) return
    const params = new URLSearchParams(window.location.search)
    const result = parseSquareCallback(params)

    // DB読み込み完了までは sessions が初期値のままで伝票を特定できないため待つ
    if (!dbLoaded) return

    if (!result) {
      squareCallbackDoneRef.current = true
      // コールバックが来ないまま戻ってきた会計が残っていないか確認する
      const stranded = loadPendingSquareCheckout(storeId)
      if (stranded) {
        if (sessions.some((s) => s.id === stranded.sessionId)) {
          startSquareRecovery(stranded)
        } else {
          // 伝票が既に無いなら復旧しようがないので保留を捨てる
          clearPendingSquareCheckout(storeId)
        }
      }
      return
    }

    squareCallbackDoneRef.current = true
    window.history.replaceState(null, "", window.location.pathname)

    const pending = loadPendingSquareCheckout(storeId)
    if (!pending) {
      if (result.ok) {
        alert(`Square決済は完了しましたが、対象の会計情報が見つかりませんでした。手動で会計を記録してください。\n決済ID: ${result.transactionId ?? "不明"}`)
      }
      return
    }

    // 複合会計の現金分だけが決済済みで残っている場合は、取りこぼさないよう必ず知らせる
    const cashLegDone = pending.phase === "cashless"
    const cashLegNotice = cashLegDone
      ? `\n※現金分 ¥${pending.data.cashAmount.toLocaleString()} はSquareで決済済みです（決済ID: ${pending.cashTransactionId ?? "不明"}）。Square側の取消要否を確認してください。`
      : ""

    if (!result.ok) {
      clearPendingSquareCheckout(storeId)
      const canceled = result.errorCode === "payment_canceled" || result.errorCode === "TRANSACTION_CANCELED"
      if (!canceled) {
        alert(`Square決済エラー: ${result.errorCode}${cashLegNotice}`)
      } else if (cashLegDone) {
        alert(`クレペイ分の決済がキャンセルされたため、会計は記録していません。${cashLegNotice}`)
      }
      return
    }

    // 決済は完了しているため、伝票が見つからない場合は取りこぼさず通知する
    if (!sessions.some((s) => s.id === pending.sessionId)) {
      clearPendingSquareCheckout(storeId)
      alert(`Square決済は完了しましたが、対象の伝票が見つかりませんでした。手動で会計を記録してください。\n金額: ¥${pending.data.totalAmount.toLocaleString()}\n決済ID: ${result.transactionId ?? "不明"}${cashLegNotice}`)
      return
    }

    // 複合会計: 現金分が終わったら続けてクレペイ分をSquareで決済する。
    // ここでは会計を記録せず、2段階目のコールバックまで持ち越す
    if (pending.phase === "cash") {
      const launched = startSquarePosPayment(
        storeId,
        {
          sessionId: pending.sessionId,
          data: pending.data,
          phase: "cashless",
          cashTransactionId: result.transactionId,
        },
        pending.data.cashlessAmount,
        "card",
      )
      if (!launched) {
        clearPendingSquareCheckout(storeId)
        alert(`現金分 ¥${pending.data.cashAmount.toLocaleString()} は決済できましたが、クレペイ分のSquareアプリを起動できませんでした。会計は記録していません。`)
      }
      return
    }

    clearPendingSquareCheckout(storeId)

    // 複合会計は現金分とクレペイ分の2件の取引IDをまとめて残す
    const squarePaymentId = pending.cashTransactionId
      ? [pending.cashTransactionId, result.transactionId].filter(Boolean).join(",")
      : result.transactionId

    handleCheckout(pending.sessionId, { ...pending.data, squarePaymentId })
  }, [sessions, dbLoaded, handleCheckout, storeId, startSquareRecovery])

  // ページが再読込されずにタブへ戻る場合もあるため、表示に戻った時点でも拾う
  useEffect(() => {
    const handleVisible = () => {
      if (document.visibilityState !== "visible") return
      if (!dbLoaded || squareRecovery) return
      // コールバック付きで戻ってきた場合は上の処理に任せる
      if (parseSquareCallback(new URLSearchParams(window.location.search))) return
      const stranded = loadPendingSquareCheckout(storeId)
      if (stranded && sessions.some((s) => s.id === stranded.sessionId)) {
        startSquareRecovery(stranded)
      }
    }
    document.addEventListener("visibilitychange", handleVisible)
    return () => document.removeEventListener("visibilitychange", handleVisible)
  }, [dbLoaded, squareRecovery, sessions, storeId, startSquareRecovery])

  // 決済できていた → 会計として記録する
  const handleRecoveryRecord = useCallback(() => {
    if (!squareRecovery) return
    const { pending, transactionId } = squareRecovery
    clearPendingSquareCheckout(storeId)
    setSquareRecovery(null)
    const squarePaymentId = pending.cashTransactionId
      ? [pending.cashTransactionId, transactionId].filter(Boolean).join(",")
      : transactionId
    handleCheckout(pending.sessionId, { ...pending.data, squarePaymentId })
  }, [squareRecovery, storeId, handleCheckout])

  // 複合会計の現金分だけ終わっていた場合は、続けてクレペイ分をSquareで決済する
  const handleRecoveryContinueCashless = useCallback(() => {
    if (!squareRecovery) return
    const { pending, transactionId } = squareRecovery
    setSquareRecovery(null)
    const launched = startSquarePosPayment(
      storeId,
      {
        sessionId: pending.sessionId,
        data: pending.data,
        phase: "cashless",
        cashTransactionId: transactionId ?? pending.cashTransactionId,
      },
      pending.data.cashlessAmount,
      "card",
    )
    if (!launched) {
      clearPendingSquareCheckout(storeId)
      alert("クレペイ分のSquareアプリを起動できませんでした。会計は記録していません。")
    }
  }, [squareRecovery, storeId])

  // 決済できていなかった → 保留を捨てて元の状態に戻す
  const handleRecoveryDiscard = useCallback(() => {
    clearPendingSquareCheckout(storeId)
    setSquareRecovery(null)
  }, [storeId])

  const handleCancelPayment = useCallback(
    (paymentId: string) => {
      const payment = payments.find((p) => p.id === paymentId)
      if (!payment || payment.canceledAt) return

      const now = new Date()

      // Payment に取消フラグ。台帳保護のため取消列だけを更新する
      setPayments((prev) =>
        prev.map((p) => (p.id === paymentId ? { ...p, canceledAt: now } : p))
      )
      cancelPaymentDb(paymentId, now).catch((e) => {
        console.error("[DB]payments cancel:", e)
        setPayments((prev) => prev.map((p) => (p.id === paymentId ? payment : p)))
        setDbError("会計の取消に失敗しました（7日を過ぎた会計は取り消せません）")
      })

      // セッションの明細を未払いに戻す
      const cancelSession = sessions.find((s) => s.id === payment.sessionId)
      const isPaidByThisPayment = (i: { id: string; paymentId?: string }) =>
        i.paymentId === paymentId || payment.paidItemIds?.includes(i.id) === true

      if (cancelSession) {
        const updatedCancelItems = cancelSession.orderItems.map((i) =>
          isPaidByThisPayment(i)
            ? { ...i, isPaid: false, paidAt: undefined, paymentId: undefined }
            : i
        )
        const restoredSession = { ...cancelSession, orderItems: updatedCancelItems, endedAt: undefined }
        upsertSessions([restoredSession], storeId).catch((e) => console.error("[DB]sessions cancel:", e))
      }
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== payment.sessionId) return s
          const updatedItems = s.orderItems.map((i) =>
            isPaidByThisPayment(i)
              ? { ...i, isPaid: false, paidAt: undefined, paymentId: undefined }
              : i
          )
          return { ...s, orderItems: updatedItems, endedAt: undefined }
        })
      )

      // プライマリ + 連結ブロックを使用中に戻す
      const allCancelBlockIds = [payment.blockId, ...(cancelSession?.linkedBlockIds ?? [])]
      setBlocks((prev) =>
        prev.map((b) =>
          allCancelBlockIds.includes(b.id)
            ? { ...b, status: "occupied", checkedOutAt: undefined }
            : b
        )
      )
    },
    [payments, sessions]
  )

  const handleMarkPaymentsSynced = useCallback((ids: string[], syncedAt: Date) => {
    setPayments((prev) =>
      prev.map((p) => ids.includes(p.id) ? { ...p, syncedToSheetAt: syncedAt } : p)
    )
    const syncedPayments = paymentsRef.current
      .filter((p) => ids.includes(p.id))
      .map((p) => ({ ...p, syncedToSheetAt: syncedAt }))
    if (syncedPayments.length > 0) {
      upsertPayments(syncedPayments, storeId).catch((e) => console.error("[DB]payments synced:", e))
    }
  }, [])

  const handleUpsertExpense = useCallback(async (expense: DailyExpense) => {
    await upsertExpense(expense, storeId)
    setExpenses((prev) => {
      const idx = prev.findIndex((e) => e.businessDate === expense.businessDate)
      return idx >= 0
        ? prev.map((e) => e.businessDate === expense.businessDate ? expense : e)
        : [...prev, expense]
    })
  }, [])

  const handleReserveBlock = useCallback((blockId: string) => {
    setBlocks((prev) =>
      prev.map((b) =>
        b.id === blockId
          ? b.status === "reserved"
            ? { ...b, status: "empty", startedAt: undefined, checkedOutAt: undefined }
            : { ...b, status: "reserved" }
          : b
      )
    )
  }, [])

  // ── 連結モード ────────────────────────────────────────────────────────

  const handleEnterLinkMode = useCallback(() => {
    setLinkMode(true)
    setLinkSelection([])
    setSidebarOpen(false)
    setSelectedBlockId(null)
  }, [])

  const handleCancelLinkMode = useCallback(() => {
    setLinkMode(false)
    setLinkSelection([])
  }, [])

  const handleToggleLinkSelection = useCallback((blockId: string) => {
    setLinkSelection((prev) => {
      if (prev.includes(blockId)) return prev.filter((id) => id !== blockId)
      // 予約済みと使用中/提供待ちの混在を禁止
      const targetStatus = blocks.find((b) => b.id === blockId)?.status
      const existingStatuses = prev.map((id) => blocks.find((b) => b.id === id)?.status)
      const hasReserved = existingStatuses.some((s) => s === "reserved") || targetStatus === "reserved"
      const hasOccupied = existingStatuses.some((s) => s === "occupied") || targetStatus === "occupied"
      if (hasReserved && hasOccupied) return prev
      return [...prev, blockId]
    })
  }, [blocks])

  const handleConfirmLink = useCallback(() => {
    if (linkSelection.length < 2) return

    const now = new Date()
    // アクティブセッションを持つブロックをプライマリに（なければ先頭）
    const primaryBlockId =
      linkSelection.find((id) => sessions.some((s) => s.blockId === id && !s.endedAt)) ??
      linkSelection[0]
    const secondaryBlockIds = linkSelection.filter((id) => id !== primaryBlockId)

    // セカンダリ席のアクティブセッションを収集し、オーダーを originBlockId 付きで取得
    const secondarySessions = secondaryBlockIds
      .map((id) => sessions.find((s) => s.blockId === id && !s.endedAt))
      .filter((s): s is BlockSession => s !== undefined)
    const mergedItems = secondarySessions.flatMap((s) =>
      s.orderItems.map((item) => ({
        ...item,
        originBlockId: item.originBlockId ?? s.blockId,
      }))
    )
    const secondarySessionIds = new Set(secondarySessions.map((s) => s.id))

    const existingSession = sessions.find((s) => s.blockId === primaryBlockId && !s.endedAt)
    if (existingSession) {
      const linkedBlockIds = [...(existingSession.linkedBlockIds ?? []), ...secondaryBlockIds]
      const guestCount = 1 + linkedBlockIds.length
      const updatedSession = {
        ...existingSession,
        linkedBlockIds,
        guestCount,
        orderItems: [...existingSession.orderItems, ...mergedItems],
      }
      const endedSecondarySessions = secondarySessions.map((s) => ({ ...s, endedAt: now }))
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id === existingSession.id) return updatedSession
          if (secondarySessionIds.has(s.id)) return { ...s, endedAt: now }
          return s
        })
      )
      upsertSessions([updatedSession, ...endedSecondarySessions], storeId).catch((e) => console.error("[DB]sessions link:", e))
      // サブブロックのステータスをプライマリに合わせる
      const primaryBlock = blocks.find((b) => b.id === primaryBlockId)
      if (primaryBlock) {
        setBlocks((prev) =>
          prev.map((b) =>
            secondaryBlockIds.includes(b.id)
              ? { ...b, status: primaryBlock.status, startedAt: primaryBlock.startedAt }
              : b
          )
        )
      }
    } else {
      // 連結対象に予約席が含まれる場合は全席を reserved のまま維持
      const hasReservedInSelection = linkSelection.some(
        (id) => blocks.find((b) => b.id === id)?.status === "reserved"
      )
      const linkedStatus = hasReservedInSelection ? "reserved" : "occupied"
      const newSession: BlockSession = {
        id: `s-${Date.now()}`,
        blockId: primaryBlockId,
        orderItems: mergedItems,
        startedAt: now,
        guestCount: 1 + secondaryBlockIds.length,
        linkedBlockIds: secondaryBlockIds,
      }
      const endedSecondarySessions = secondarySessions.map((s) => ({ ...s, endedAt: now }))
      setSessions((prev) => [
        ...prev.map((s) => (secondarySessionIds.has(s.id) ? { ...s, endedAt: now } : s)),
        newSession,
      ])
      upsertSessions([newSession, ...endedSecondarySessions], storeId).catch((e) => console.error("[DB]sessions link new:", e))
      setBlocks((prev) =>
        prev.map((b) =>
          b.id === primaryBlockId || secondaryBlockIds.includes(b.id)
            ? { ...b, status: linkedStatus }
            : b
        )
      )
    }

    setLinkMode(false)
    setLinkSelection([])
  }, [linkSelection, sessions, blocks])

  const handleUnlinkBlock = useCallback((
    sessionId: string,
    blockIdToUnlink: string,
    itemQuantities: Record<string, number>,
  ) => {
    const target = sessions.find((s) => s.id === sessionId)
    if (!target) return

    // 解除する席へ移すオーダーはサイドバーで数量ごとに選ばれている。
    // 会計済みの明細は payments と紐付いているため元の伝票に残す。
    const splitItems: OrderItem[] = []
    const remainingItems: OrderItem[] = []
    target.orderItems.forEach((i) => {
      const moveQty = i.isPaid ? 0 : Math.min(itemQuantities[i.id] ?? 0, i.quantity)
      if (moveQty <= 0) {
        remainingItems.push(i)
        return
      }
      if (moveQty >= i.quantity) {
        splitItems.push(i)
        return
      }
      // 数量の一部だけ移す場合は明細を分割する
      splitItems.push({
        ...i,
        id: `i-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        quantity: moveQty,
        subtotal: i.price * moveQty,
      })
      remainingItems.push({
        ...i,
        quantity: i.quantity - moveQty,
        subtotal: i.price * (i.quantity - moveQty),
      })
    })

    // 連結時に合算されなかった場合に残っている可能性のある既存セッション
    const existingSecondarySession = sessions.find(
      (s) => s.blockId === blockIdToUnlink && !s.endedAt && s.id !== sessionId
    )

    const now = new Date()
    const linkedBlockIds = (target.linkedBlockIds ?? []).filter((id) => id !== blockIdToUnlink)
    const newLinkedBlockIds = linkedBlockIds.length > 0 ? linkedBlockIds : undefined
    const guestCount = newLinkedBlockIds ? 1 + newLinkedBlockIds.length : 1
    const remainingSession = { ...target, linkedBlockIds: newLinkedBlockIds, guestCount, orderItems: remainingItems }

    // オーダーを全て解除先へ移した場合、元の伝票は空になるので来店終了として扱う。
    // 残しておくと使用中のまま席が固まり、入店時間や顧客名も次の客に引き継がれてしまう。
    const primaryHasUnpaid = remainingItems.some((i) => !i.isPaid)
    const updatedSession = primaryHasUnpaid
      ? remainingSession
      : stripGuestInfo({ ...remainingSession, endedAt: remainingSession.endedAt ?? now })

    const sessionsToUpsert: BlockSession[] = [updatedSession]

    if (splitItems.length > 0) {
      // originBlockId を除去して新セッションを作成
      const restoredItems = splitItems.map(({ originBlockId: _orig, ...item }) => item)
      const splitSession: BlockSession = {
        id: `s-${Date.now()}`,
        blockId: blockIdToUnlink,
        orderItems: restoredItems,
        startedAt: target.startedAt,
        guestCount: 1,
      }
      setSessions((prev) => [
        ...prev.map((s) => (s.id === sessionId ? updatedSession : s)),
        splitSession,
      ])
      sessionsToUpsert.push(splitSession)
    } else {
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? updatedSession : s)))
    }

    lastLocalWriteRef.current = Date.now()
    upsertSessions(sessionsToUpsert, storeId).catch((e) => console.error("[DB]sessions unlink:", e))

    // ステータス決定: 分離アイテムか既存セッションのいずれかに未払いアイテムがあれば occupied
    const hasUnpaidItems =
      splitItems.some((i) => !i.isPaid) ||
      (existingSecondarySession?.orderItems.some((i) => !i.isPaid) ?? false)
    const startedAt = hasUnpaidItems
      ? (existingSecondarySession?.startedAt ?? target.startedAt)
      : undefined
    // 元の伝票側（プライマリ + 残った連結席）も空になったら空席に戻す
    const remainingBlockIds = [target.blockId, ...(newLinkedBlockIds ?? [])]
    setBlocks((prev) =>
      prev.map((b) => {
        if (b.id === blockIdToUnlink) {
          return hasUnpaidItems
            ? { ...b, status: "occupied", startedAt }
            : { ...b, status: "empty", startedAt: undefined, checkedOutAt: undefined }
        }
        if (!primaryHasUnpaid && remainingBlockIds.includes(b.id)) {
          return { ...b, status: "empty", startedAt: undefined, checkedOutAt: undefined }
        }
        return b
      })
    )

    // 元の席が空席になったら接客情報のローカルキャッシュも破棄する
    if (!primaryHasUnpaid) {
      const clearCache = <T,>(prev: Record<string, T>): Record<string, T> => {
        const next = { ...prev }
        remainingBlockIds.forEach((id) => delete next[id])
        return next
      }
      setCustomerNames(clearCache)
      setHappyHourByBlock(clearCache)
      setNewCustomerByBlock(clearCache)
    }
  }, [sessions])

  // ── 席移動モード ──────────────────────────────────────────────────────

  const handleEnterMoveMode = useCallback(() => {
    setMoveMode(true)
    setMoveSource(null)
    setMoveDests([])
    setLinkMode(false)
    setLinkSelection([])
    setSidebarOpen(false)
    setSelectedBlockId(null)
  }, [])

  const handleCancelMoveMode = useCallback(() => {
    setMoveMode(false)
    setMoveSource(null)
    setMoveDests([])
  }, [])

  const handleMoveBlockSelect = useCallback((blockId: string) => {
    // ステップ1: 移動元を選択（連結席ならグループ全体が移動元になる）
    if (moveSource === null) {
      setMoveSource(blockId)
      setMoveDests([])
      return
    }
    // 移動元グループのどれかを再タップ → 選択を解除
    if (moveSourceBlockIds.includes(blockId)) {
      setMoveSource(null)
      setMoveDests([])
      return
    }
    // ステップ2: 移動先をトグル。必要席数に達したらそれ以上は選べない
    setMoveDests((prev) => {
      if (prev.includes(blockId)) return prev.filter((id) => id !== blockId)
      if (prev.length >= moveSourceBlockIds.length) return prev
      return [...prev, blockId]
    })
  }, [moveSource, moveSourceBlockIds])

  const handleConfirmMove = useCallback(() => {
    if (!moveSourceSession) return
    // 連結席は席数が一致していないと移せない
    if (moveDests.length !== moveSourceBlockIds.length) return

    const oldPrimary = moveSourceSession.blockId
    const primarySourceBlock = blocks.find((b) => b.id === oldPrimary)
    const [newPrimary, ...newSecondaries] = moveDests

    // 移動元→移動先の対応表。連結解除時の分割に使う originBlockId も付け替える
    const blockIdMap: Record<string, string> = {}
    moveSourceBlockIds.forEach((oldId, i) => { blockIdMap[oldId] = moveDests[i] })

    const movedSession: BlockSession = {
      ...moveSourceSession,
      blockId: newPrimary,
      linkedBlockIds: newSecondaries.length > 0 ? newSecondaries : undefined,
      orderItems: moveSourceSession.orderItems.map((i) =>
        i.originBlockId && blockIdMap[i.originBlockId]
          ? { ...i, originBlockId: blockIdMap[i.originBlockId] }
          : i,
      ),
    }
    setSessions((prev) => prev.map((s) => (s.id === movedSession.id ? movedSession : s)))
    lastLocalWriteRef.current = Date.now()
    upsertSessions([movedSession], storeId).catch((e) => console.error("[DB]sessions move:", e))

    // ブロックのステータスを付け替え（checkedOutAt も含めて完全転送）。
    // 連結席は全席が同じステータス・入店時間を共有するのでプライマリの値を配る
    setBlocks((prev) =>
      prev.map((b) => {
        if (moveSourceBlockIds.includes(b.id)) {
          return { ...b, status: "empty", startedAt: undefined, checkedOutAt: undefined }
        }
        if (moveDests.includes(b.id)) {
          return {
            ...b,
            status: primarySourceBlock?.status ?? "occupied",
            startedAt: primarySourceBlock?.startedAt,
            checkedOutAt: primarySourceBlock?.checkedOutAt,
          }
        }
        return b
      })
    )

    // 分割会計の進捗が残っていれば移動先の席に付け替える
    const plan = loadSplitPlan(storeId)
    if (plan && plan.sessionId === movedSession.id) {
      saveSplitPlan(storeId, { ...plan, blockId: newPrimary })
    }

    // ローカルキャッシュ（顧客名・ハッピーアワー・新規客）を移動元から移動先へ転送し、移動元は完全クリア
    const transferCache = <T,>(prev: Record<string, T>): Record<string, T> => {
      const next = { ...prev }
      if (next[oldPrimary] !== undefined) next[newPrimary] = next[oldPrimary]
      moveSourceBlockIds.forEach((id) => delete next[id])
      return next
    }
    setCustomerNames(transferCache)
    setHappyHourByBlock(transferCache)
    setNewCustomerByBlock(transferCache)

    setMoveMode(false)
    setMoveSource(null)
    setMoveDests([])
  }, [moveSourceSession, moveSourceBlockIds, moveDests, blocks])

  const handleSaveLayout = useCallback(
    (newBlocks: ServiceBlock[], newElements: LayoutElement[]) => {
      setBlocks(newBlocks)
      setLayoutElements(newElements)
      setActiveTab("map")
      // レイアウト保存時は削除も含む完全同期
      syncBlocks(newBlocks, storeId).catch((e) => console.error("[DB]syncBlocks:", e))
    },
    []
  )

  // ── 商品マスタ: Supabase 連携ハンドラ ────────────────────────────────

  const handleUpdateProducts = useCallback(async (updated: Product[]) => {
    const prev = products

    // 削除されたもの
    const deleted = prev.filter((p) => !updated.find((u) => u.id === p.id))
    // 追加されたもの
    const added = updated.filter((u) => !prev.find((p) => p.id === u.id))
    // 変更されたもの
    const changed = updated.filter((u) => {
      const old = prev.find((p) => p.id === u.id)
      return old && (
        old.name !== u.name ||
        old.price !== u.price ||
        old.isActive !== u.isActive ||
        old.category !== u.category
      )
    })

    setProducts(updated) // 楽観的更新

    try {
      await Promise.all([
        ...deleted.map((p) => deleteProduct(p.id, storeId)),
        ...added.map((p) => createProduct(p, storeId)),
        ...changed.map((p) => updateProduct(p.id, { name: p.name, price: p.price, isActive: p.isActive, category: p.category }, storeId)),
      ])
    } catch (err) {
      console.error("商品更新エラー:", err)
      setProducts(prev) // ロールバック
      setDbError("商品の保存に失敗しました")
    }
  }, [products])

  // 並び替え専用。追加・削除・内容変更を伴わないので差分検出を通さず、
  // 変わった display_order だけをまとめて書く
  const handleReorderProducts = useCallback(async (reordered: Product[]) => {
    const prev = products
    const changed = changedOrders(prev, reordered)
    if (changed.length === 0) return

    setProducts(reordered) // 楽観的更新

    try {
      await updateProductOrders(changed, storeId)
    } catch (err) {
      console.error("商品並び替えエラー:", err)
      setProducts(prev) // ロールバック
      setDbError("並び順の保存に失敗しました")
    }
  }, [products, storeId])

  const handleUpdateCoupons = useCallback(async (newCoupons: Coupon[]) => {
    const prev = coupons
    const deleted = prev.filter((o) => !newCoupons.find((n) => n.id === o.id) && /^\d+$/.test(o.id))
    const added = newCoupons.filter((n) => !/^\d+$/.test(n.id))
    const changed = newCoupons.filter((n) => {
      if (!/^\d+$/.test(n.id)) return false
      const old = prev.find((o) => o.id === n.id)
      return old && (old.name !== n.name || old.discountType !== n.discountType || old.discountValue !== n.discountValue || old.isActive !== n.isActive)
    })

    setCoupons(newCoupons)

    try {
      await Promise.all([
        ...deleted.map((c) => deleteCoupon(c.id, storeId)),
        ...changed.map((c) => updateCouponDb(c.id, c, storeId)),
      ])
      for (const c of added) {
        const inserted = await insertCoupon(c, storeId)
        setCoupons((prev) => prev.map((x) => x.id === c.id ? inserted : x))
      }
    } catch (err) {
      console.error("[DB]coupons:", err)
      setCoupons(prev)
    }
  }, [coupons, storeId])

  return (
    // h-dvh: スマホのURLバーが出ている間も画面内に収まる高さにする（100vhだとバーの裏に隠れる）
    <div className="flex h-dvh flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-3 py-2 sm:px-4 sm:py-3">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground sm:h-10 sm:w-10">
            <UtensilsCrossed className="h-4 w-4 sm:h-5 sm:w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold sm:text-lg">{settings.storeName}</h1>
            <p className="hidden text-xs text-muted-foreground sm:block">卓番管理・会計システム</p>
          </div>
        </div>

        <nav className="flex gap-0.5 rounded-lg bg-muted p-1 sm:gap-1">
          <Button
            variant="ghost"
            size="sm"
            className={cn("gap-1.5 rounded-md px-2 sm:px-4", activeTab === "map" && "bg-background shadow-sm")}
            onClick={() => setActiveTab("map")}
          >
            <LayoutGrid className="h-4 w-4" />
            <span className="hidden sm:inline">フロア管理</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn("gap-1.5 rounded-md px-2 sm:px-4", activeTab === "editor" && "bg-background shadow-sm")}
            onClick={() => setActiveTab("editor")}
          >
            <Edit3 className="h-4 w-4" />
            <span className="hidden sm:inline">レイアウト編集</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn("gap-1.5 rounded-md px-2 sm:px-4", activeTab === "report" && "bg-background shadow-sm")}
            onClick={() => setActiveTab("report")}
          >
            <BarChart3 className="h-4 w-4" />
            <span className="hidden sm:inline">日計・設定</span>
          </Button>
        </nav>

        <div className="flex shrink-0 justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 px-2 sm:px-3"
            onClick={loadAllFromDB}
            disabled={dbLoading}
            title="全データを再読み込み"
          >
            <RefreshCw className={cn("h-4 w-4", dbLoading && "animate-spin")} />
            <span className="hidden sm:inline text-xs">更新</span>
          </Button>
        </div>
      </header>

      {/* 席状況早見表 (マップタブのみ表示) */}
      {activeTab === "map" && (
        <div className="sticky top-12 z-9 border-b border-border bg-card px-3 py-2 sm:top-16 sm:px-4 sm:py-2.5">
          {linkMode ? (
            <div className="flex flex-wrap items-center gap-2">
              <Link2 className="h-4 w-4 shrink-0 text-info" />
              <span className="text-sm font-medium text-info">連結する席を選択</span>
              <span className="text-xs text-muted-foreground">{linkSelection.length}席選択中</span>
              <Button size="sm" className="ml-auto bg-success text-primary-foreground hover:bg-success/90 sm:ml-1" disabled={linkSelection.length < 2} onClick={handleConfirmLink}>連結する</Button>
              <Button size="sm" variant="ghost" onClick={handleCancelLinkMode}>キャンセル</Button>
            </div>
          ) : moveMode ? (
            <div className="flex flex-wrap items-center gap-2">
              <ArrowRightLeft className="h-4 w-4 shrink-0 text-amber-500" />
              <span className="text-sm font-medium text-amber-600">
                {moveSource === null
                  ? "移動元の席をタップ（連結席はグループごと移動）"
                  : moveSourceBlockIds.length > 1
                  ? `移動先の空席を${moveSourceBlockIds.length}席タップ（${moveDests.length}/${moveSourceBlockIds.length}）`
                  : "移動先の空席をタップ"}
              </span>
              {moveSource && (
                <Button
                  size="sm"
                  className="ml-auto bg-success text-primary-foreground hover:bg-success/90 sm:ml-1"
                  disabled={!moveSourceSession || moveDests.length !== moveSourceBlockIds.length}
                  onClick={handleConfirmMove}
                >
                  移動する
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={handleCancelMoveMode}>キャンセル</Button>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <div className="flex items-center gap-1">
                  <div className="h-2.5 w-2.5 rounded bg-table-empty" />
                  <span className="text-muted-foreground">空席</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="h-2.5 w-2.5 rounded bg-table-reserved" />
                  <span className="text-muted-foreground">予約</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="h-2.5 w-2.5 rounded bg-table-occupied" />
                  <span className="text-muted-foreground">使用中</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="h-2.5 w-2.5 rounded bg-table-checked-out" />
                  <span className="text-muted-foreground">会計済</span>
                </div>
                <div className="flex items-center gap-1">
                  <Link2 className="h-2.5 w-2.5 text-info" />
                  <span className="text-muted-foreground">連結中</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs sm:h-8 sm:gap-1.5 sm:px-3" onClick={handleEnterLinkMode}>
                  <Link2 className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                  席を連結
                </Button>
                <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs sm:h-8 sm:gap-1.5 sm:px-3" onClick={handleEnterMoveMode}>
                  <ArrowRightLeft className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                  席移動
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 overflow-hidden p-2 sm:p-4">
        {activeTab === "map" && (
          <FloorMap
            blocks={blocks}
            sessions={sessions}
            layoutElements={layoutElements}
            selectedBlockId={selectedBlockId}
            onBlockClick={handleBlockClick}
            linkMode={linkMode}
            linkSelection={linkSelection}
            onEnterLinkMode={handleEnterLinkMode}
            onToggleLinkSelection={handleToggleLinkSelection}
            onConfirmLink={handleConfirmLink}
            onCancelLinkMode={handleCancelLinkMode}
            moveMode={moveMode}
            moveSourceBlockIds={moveSourceBlockIds}
            moveDests={moveDests}
            onEnterMoveMode={handleEnterMoveMode}
            onMoveBlockSelect={handleMoveBlockSelect}
            onConfirmMove={handleConfirmMove}
            onCancelMoveMode={handleCancelMoveMode}
            onDoubleTapBussing={bussingById}
          />
        )}

        {activeTab === "editor" && (
          <LayoutEditor
            blocks={blocks}
            layoutElements={layoutElements}
            onSaveLayout={handleSaveLayout}
          />
        )}

        {activeTab === "report" && (
          <AdminReport
            storeId={storeId}
            blocks={blocks}
            payments={payments}
            sessions={sessions}
            settings={settings}
            products={products}
            coupons={coupons}
            expenses={expenses}
            onCancelPayment={handleCancelPayment}
            onUpdateSettings={setSettings}
            onUpdateProducts={handleUpdateProducts}
            onReorderProducts={handleReorderProducts}
            onUpdateCoupons={handleUpdateCoupons}
            onMarkPaymentsSynced={handleMarkPaymentsSynced}
            onUpsertExpense={handleUpsertExpense}
          />
        )}
        {/* Square から戻れなかった会計の確認。決済履歴と照合したうえで記録/破棄を選ぶ */}
        {squareRecovery && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-sm rounded-2xl bg-card p-5 shadow-2xl">
              <div className="mb-3 flex items-center gap-2 text-warning">
                <RefreshCw className="h-5 w-5" />
                <h3 className="font-bold">未処理のSquare決済があります</h3>
              </div>

              <div className="mb-4 space-y-1 rounded-lg bg-muted p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">席</span>
                  <span className="font-medium">{squareRecovery.blockName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Squareへ渡した金額</span>
                  <span className="font-bold">
                    ¥{(squareRecovery.pending.amount ?? squareRecovery.pending.data.totalAmount).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">操作時刻</span>
                  <span>{new Date(squareRecovery.pending.createdAt).toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                </div>
                {squareRecovery.pending.phase === "cash" && (
                  <p className="pt-1 text-xs text-warning">
                    複合会計の現金分です。クレペイ分 ¥{squareRecovery.pending.data.cashlessAmount.toLocaleString()} はまだ決済されていません。
                  </p>
                )}
              </div>

              {squareRecovery.lookup === "loading" && (
                <p className="mb-4 text-sm text-muted-foreground">Squareの決済履歴を照会しています…</p>
              )}
              {squareRecovery.lookup === "found" && (
                <p className="mb-4 rounded-lg bg-success/15 p-3 text-sm font-medium text-success">
                  同額の決済がSquare側に見つかりました。会計として記録できます。
                </p>
              )}
              {squareRecovery.lookup === "notfound" && (
                <p className="mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                  同額の決済がSquare側に見つかりませんでした。決済されていない可能性があります。
                  Squareアプリの履歴を確認してから選んでください。
                </p>
              )}
              {squareRecovery.lookup === "error" && (
                <p className="mb-4 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                  Squareへの照会に失敗しました（{squareRecovery.lookupError}）。
                  Squareアプリの履歴を確認してから選んでください。
                </p>
              )}

              <div className="space-y-2">
                {squareRecovery.pending.phase === "cash" ? (
                  <Button
                    size="lg"
                    className="h-12 w-full"
                    disabled={squareRecovery.lookup === "loading"}
                    onClick={handleRecoveryContinueCashless}
                  >
                    現金分は決済済み → クレペイ分に進む
                  </Button>
                ) : (
                  <Button
                    size="lg"
                    className="h-12 w-full bg-success text-primary-foreground hover:bg-success/90"
                    disabled={squareRecovery.lookup === "loading"}
                    onClick={handleRecoveryRecord}
                  >
                    決済できていた → 会計を記録
                  </Button>
                )}
                <Button
                  size="lg"
                  variant="outline"
                  className="h-12 w-full"
                  disabled={squareRecovery.lookup === "loading"}
                  onClick={handleRecoveryDiscard}
                >
                  決済していない → 破棄して席に戻す
                </Button>
              </div>
            </div>
          </div>
        )}

        {dbError && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-destructive px-4 py-2 text-sm text-destructive-foreground shadow-lg">
            {dbError}
            <button className="ml-3 underline" onClick={() => setDbError(null)}>閉じる</button>
          </div>
        )}
      </main>

      {/* Order Sidebar */}
      <OrderSidebar
        storeId={storeId}
        isOpen={sidebarOpen && activeTab === "map"}
        onClose={handleCloseSidebar}
        selectedBlock={selectedBlock}
        session={currentSession}
        products={products}
        coupons={coupons}
        settings={settings}
        blocks={blocks}
        onUpdateSession={handleUpdateSession}
        onCheckout={handleCheckout}
        onUnlinkBlock={handleUnlinkBlock}
        onBussingComplete={handleBussingComplete}
        onReserveBlock={handleReserveBlock}
        happyHour={currentHappyHour}
        onHappyHourChange={handleHappyHourChange}
        customerName={currentCustomerName}
        onCustomerNameChange={handleCustomerNameChange}
        isNewCustomer={currentIsNewCustomer}
        onIsNewCustomerChange={handleIsNewCustomerChange}
        resumeSplit={resumeSplit}
        onResumeSplitHandled={handleResumeSplitHandled}
      />

      {sidebarOpen && activeTab === "map" && (
        <div
          className="fixed inset-0 z-40 bg-black/50"
          onClick={handleCloseSidebar}
        />
      )}
    </div>
  )
}
