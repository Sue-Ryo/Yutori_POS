"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import type {
  ServiceBlock,
  BlockSession,
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
  STORAGE_KEYS,
  loadList,
  saveList,
  loadObject,
  saveObject,
  revivers,
} from "@/lib/pos-storage"
import { supabase } from "@/lib/supabase"
import { fetchProducts, createProduct, updateProduct, deleteProduct } from "@/lib/api/products"
import { fetchBlocks, upsertBlocks, syncBlocks } from "@/lib/api/blocks"
import { fetchSessions, upsertSessions } from "@/lib/api/sessions"
import { fetchPayments, upsertPayments } from "@/lib/api/payments-db"
import { fetchSettings, upsertSettings } from "@/lib/api/settings-db"
import { fetchCoupons, syncCoupons } from "@/lib/api/coupons-db"
import { fetchLayoutElements, upsertLayoutElements } from "@/lib/api/layout-db"
import { fetchExpenses, upsertExpense } from "@/lib/api/expenses-db"
import { FloorMap } from "./floor-map"
import { OrderSidebar } from "./order-sidebar"
import { LayoutEditor } from "./layout-editor"
import { AdminReport } from "./admin-report"
import { Button } from "@/components/ui/button"
import { LayoutGrid, Edit3, BarChart3, UtensilsCrossed, RefreshCw, Link2, ArrowRightLeft } from "lucide-react"

type Tab = "map" | "editor" | "report"

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
  const [dbError, setDbError] = useState<string | null>(null)
  const dbSyncingRef = useRef(false)
  const paymentsRef = useRef<Payment[]>([])

  // Supabase から全データを取得
  const loadAllFromDB = useCallback(async () => {
    setDbLoading(true)
    dbSyncingRef.current = true
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
      if (dbBlocks !== null) setBlocks(dbBlocks)
      if (dbSessions !== null) setSessions(dbSessions)
      if (dbPayments !== null) {
        if (dbPayments.length > 0) {
          // DB にデータあり → DB を正とする
          setPayments(dbPayments)
        } else {
          // DB が空 → localStorage のデータを保持し、後で DB へ移行する
          shouldMigratePayments = true
        }
      }
      if (dbSettings !== null) setSettings(dbSettings)
      if (dbCoupons !== null) setCoupons(dbCoupons)
      if (dbElements !== null) setLayoutElements(dbElements)
      if (dbProducts !== null) setProducts(dbProducts)
      if (dbExpenses !== null) setExpenses(dbExpenses)
      console.log("[POSSystem] DB読み込み完了")
    } catch (err) {
      console.error("DB読み込みエラー:", err)
      setDbError("データの取得に失敗しました（ローカルデータを使用）")
    } finally {
      setDbLoading(false)
      setTimeout(() => {
        dbSyncingRef.current = false
        // localStorage にあった会計データを DB へ移行
        if (shouldMigratePayments && paymentsRef.current.length > 0) {
          console.log("[DB]payments migrate:", paymentsRef.current.length, "件をDBへ書き込み")
          upsertPayments(paymentsRef.current, storeId).catch((e) => console.error("[DB]payments migrate:", e))
        }
      }, 300)
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
    const channel = supabase
      .channel("pos_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "blocks" }, () => {
        fetchBlocks(storeId).then((data) => {
          dbSyncingRef.current = true
          setBlocks(data)
          setTimeout(() => { dbSyncingRef.current = false }, 300)
        }).catch((e) => console.error("[RT]blocks:", e))
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "sessions" }, () => {
        fetchSessions(storeId).then((data) => {
          dbSyncingRef.current = true
          setSessions(data)
          setTimeout(() => { dbSyncingRef.current = false }, 300)
        }).catch((e) => console.error("[RT]sessions:", e))
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, () => {
        fetchPayments(storeId).then((data) => {
          dbSyncingRef.current = true
          setPayments(data)
          setTimeout(() => { dbSyncingRef.current = false }, 300)
        }).catch((e) => console.error("[RT]payments:", e))
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "layout_elements" }, () => {
        fetchLayoutElements(storeId).then((data) => {
          dbSyncingRef.current = true
          setLayoutElements(data)
          setTimeout(() => { dbSyncingRef.current = false }, 300)
        }).catch((e) => console.error("[RT]layout_elements:", e))
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "pos_settings" }, () => {
        fetchSettings(storeId).then((data) => {
          if (data) {
            dbSyncingRef.current = true
            setSettings(data)
            setTimeout(() => { dbSyncingRef.current = false }, 300)
          }
        }).catch((e) => console.error("[RT]pos_settings:", e))
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "coupons" }, () => {
        fetchCoupons(storeId).then((data) => {
          dbSyncingRef.current = true
          setCoupons(data)
          setTimeout(() => { dbSyncingRef.current = false }, 300)
        }).catch((e) => console.error("[RT]coupons:", e))
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, () => {
        fetchProducts(storeId).then((data) => {
          dbSyncingRef.current = true
          setProducts(data)
          setTimeout(() => { dbSyncingRef.current = false }, 300)
        }).catch((e) => console.error("[RT]products:", e))
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "daily_expenses" }, () => {
        fetchExpenses(storeId).then((data) => {
          dbSyncingRef.current = true
          setExpenses(data)
          setTimeout(() => { dbSyncingRef.current = false }, 300)
        }).catch((e) => console.error("[RT]daily_expenses:", e))
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // paymentsRef を最新 state と常に同期（loadAllFromDB 内で移行書き込み用）
  useEffect(() => { paymentsRef.current = payments }, [payments])

  // 状態変化時に localStorage へ保存（初期ロード後のみ）
  // ※ このsave effectsは必ずloadEffectより前に定義すること（effect実行順序に依存）
  useEffect(() => { if (initializedRef.current) saveList(STORAGE_KEYS.blocks, blocks) }, [blocks])
  useEffect(() => { if (initializedRef.current) saveList(STORAGE_KEYS.layoutElements, layoutElements) }, [layoutElements])
  useEffect(() => { if (initializedRef.current) saveList(STORAGE_KEYS.sessions, sessions) }, [sessions])
  useEffect(() => { if (initializedRef.current) saveList(STORAGE_KEYS.payments, payments) }, [payments])
  useEffect(() => { if (initializedRef.current) saveObject(STORAGE_KEYS.settings, settings) }, [settings])
  useEffect(() => { if (initializedRef.current) saveList(STORAGE_KEYS.coupons, coupons) }, [coupons])

  // 状態変化時に Supabase へ同期（DB読み込み中は除外）
  useEffect(() => {
    if (!initializedRef.current || dbSyncingRef.current) return
    upsertBlocks(blocks, storeId).catch((e) => console.error("[DB]blocks:", e))
  }, [blocks])
  useEffect(() => {
    if (!initializedRef.current || dbSyncingRef.current) return
    upsertLayoutElements(layoutElements, storeId).catch((e) => console.error("[DB]layout:", e))
  }, [layoutElements])
  useEffect(() => {
    if (!initializedRef.current || dbSyncingRef.current) return
    upsertSessions(sessions, storeId).catch((e) => console.error("[DB]sessions:", e))
  }, [sessions])
  useEffect(() => {
    if (!initializedRef.current || dbSyncingRef.current) return
    upsertPayments(payments, storeId).catch((e) => console.error("[DB]payments:", e))
  }, [payments])
  useEffect(() => {
    if (!initializedRef.current || dbSyncingRef.current) return
    upsertSettings(storeId, settings).catch((e) => console.error("[DB]settings:", e))
  }, [settings])
  useEffect(() => {
    if (!initializedRef.current || dbSyncingRef.current) return
    syncCoupons(coupons, storeId).catch((e) => console.error("[DB]coupons:", e))
  }, [coupons])

  // localStorage から読み込む（クライアントサイドのみ・save effectsより後に定義すること）
  useEffect(() => {
    const savedBlocks = loadList(STORAGE_KEYS.blocks, revivers.reviveBlock)
    const savedElements = loadList(STORAGE_KEYS.layoutElements, (r) => r as unknown as LayoutElement)
    const savedSessions = loadList(STORAGE_KEYS.sessions, revivers.reviveSession)
    const savedPayments = loadList(STORAGE_KEYS.payments, revivers.revivePayment)
    const savedSettings = loadObject<BusinessSettings>(STORAGE_KEYS.settings)
    const savedCoupons = loadList(STORAGE_KEYS.coupons, (r) => r as unknown as Coupon)
    if (savedBlocks !== null) setBlocks(savedBlocks)
    if (savedElements !== null) setLayoutElements(savedElements)
    if (savedSessions !== null) setSessions(savedSessions)
    if (savedPayments !== null) setPayments(savedPayments)
    if (savedSettings !== null) setSettings(savedSettings)
    if (savedCoupons !== null) setCoupons(savedCoupons)
    initializedRef.current = true
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // セッション未作成時のローカルキャッシュ（初回オーダー時にセッションへ統合）
  const [happyHourByBlock, setHappyHourByBlock] = useState<Record<string, boolean>>({})
  const [customerNames, setCustomerNames] = useState<Record<string, string>>({})
  const [linkMode, setLinkMode] = useState(false)
  const [linkSelection, setLinkSelection] = useState<string[]>([])
  const [moveMode, setMoveMode] = useState(false)
  const [moveSource, setMoveSource] = useState<string | null>(null)
  const [moveDest, setMoveDest] = useState<string | null>(null)

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
      upsertSessions([updated], storeId).catch((e) => console.error("[DB]sessions happyHour:", e))
    }
  }, [selectedBlockId, currentSession])

  const currentCustomerName = currentSession?.customerName ?? (selectedBlockId ? (customerNames[selectedBlockId] ?? "") : "")
  const handleCustomerNameChange = useCallback((name: string) => {
    if (!selectedBlockId) return
    setCustomerNames((prev) => ({ ...prev, [selectedBlockId]: name }))
    if (currentSession) {
      const updated = { ...currentSession, customerName: name }
      setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
      upsertSessions([updated], storeId).catch((e) => console.error("[DB]sessions customerName:", e))
    }
  }, [selectedBlockId, currentSession])

  const handleBlockClick = useCallback((blockId: string) => {
    // 連結先（サブ）ブロックをクリックした場合はプライマリブロックのセッションを開く
    const ownerSession = sessions.find(
      (s) => !s.endedAt && (s.linkedBlockIds ?? []).includes(blockId)
    )
    setSelectedBlockId(ownerSession ? ownerSession.blockId : blockId)
    setSidebarOpen(true)
  }, [sessions])

  const handleCloseSidebar = useCallback(() => {
    setSidebarOpen(false)
    setSelectedBlockId(null)
  }, [])

  const bussingById = useCallback((blockId: string) => {
    const endedSession = sessions.find(
      (s) =>
        (s.blockId === blockId || (s.linkedBlockIds ?? []).includes(blockId)) &&
        s.endedAt,
    )
    const allBlockIds = endedSession
      ? [endedSession.blockId, ...(endedSession.linkedBlockIds ?? [])]
      : [blockId]
    setBlocks((prev) =>
      prev.map((b) =>
        allBlockIds.includes(b.id)
          ? { ...b, status: "empty", startedAt: undefined, checkedOutAt: undefined }
          : b,
      ),
    )
    setCustomerNames((prev) => {
      const next = { ...prev }
      allBlockIds.forEach((id) => delete next[id])
      return next
    })
  }, [sessions])

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
          }
      setSessions((prev) => {
        const exists = prev.find((s) => s.id === sessionWithCache.id)
        if (exists) {
          return prev.map((s) => (s.id === sessionWithCache.id ? sessionWithCache : s))
        }
        return [...prev, sessionWithCache]
      })
      // useEffect の dbSyncingRef ガードに依存せず直接同期
      upsertSessions([sessionWithCache], storeId).catch((e) => console.error("[DB]sessions update:", e))

      const unpaidItems = updatedSession.orderItems.filter((i) => !i.isPaid)
      const hasItems = unpaidItems.length > 0
      const status = hasItems ? "occupied" : "empty"
      const totalQty = unpaidItems.reduce((sum, i) => sum + i.quantity, 0)
      // プライマリ + 連結ブロック全てのステータスを更新
      const allBlockIds = [updatedSession.blockId, ...(updatedSession.linkedBlockIds ?? [])]
      setBlocks((prev) =>
        prev.map((b) => {
          if (!allBlockIds.includes(b.id)) return b
          if (!hasItems) return { ...b, status: "empty", startedAt: undefined }
          // 累計3オーダーに達したタイミングで初めてタイマー開始
          const startedAt = totalQty >= 3 ? (b.startedAt ?? new Date()) : b.startedAt
          return { ...b, status, startedAt }
        })
      )
    },
    [sessions, customerNames, happyHourByBlock]
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
        paidItemIds: targetItemIds,
        couponId: data.couponId,
        customerName: data.customerName,
        sessionStartedAt: session.startedAt,
      }
      setPayments((prev) => [newPayment, ...prev])

      // セッションの明細を支払済に更新
      const updatedItems = session.orderItems.map((i) =>
        targetItemIds.includes(i.id)
          ? { ...i, isPaid: true, paidAt: now }
          : i
      )
      const allPaid = updatedItems.every((i) => i.isPaid)
      const updatedSession: BlockSession = {
        ...session,
        orderItems: updatedItems,
        guestCount: data.guestCount,
        endedAt: allPaid ? now : undefined,
      }
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? updatedSession : s)))

      // プライマリ + 連結ブロック全て更新
      const allBlockIds = [session.blockId, ...(session.linkedBlockIds ?? [])]
      setBlocks((prev) =>
        prev.map((b) => {
          if (!allBlockIds.includes(b.id)) return b
          if (allPaid) {
            return { ...b, status: "checked_out", checkedOutAt: now }
          }
          // 一部会計済みの場合はステータス再計算
          const remaining = updatedItems.filter((i) => !i.isPaid)
          const hasUnserved = remaining.some((i) => i.servingStatus === "unserved")
          return { ...b, status: remaining.length > 0 ? "occupied" : "empty" }
        })
      )

      handleCloseSidebar()
    },
    [sessions, settings.businessDayStartTime, handleCloseSidebar]
  )

  const handleCancelPayment = useCallback(
    (paymentId: string) => {
      const payment = payments.find((p) => p.id === paymentId)
      if (!payment || payment.canceledAt) return

      const now = new Date()

      // Payment に取消フラグ
      setPayments((prev) =>
        prev.map((p) => (p.id === paymentId ? { ...p, canceledAt: now } : p))
      )

      // セッションの明細を未払いに戻す
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== payment.sessionId) return s
          const updatedItems = s.orderItems.map((i) =>
            payment.paidItemIds.includes(i.id)
              ? { ...i, isPaid: false, paidAt: undefined }
              : i
          )
          return { ...s, orderItems: updatedItems, endedAt: undefined }
        })
      )

      // プライマリ + 連結ブロックを使用中に戻す
      const cancelSession = sessions.find((s) => s.id === payment.sessionId)
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
          ? { ...b, status: b.status === "reserved" ? "empty" : "reserved" }
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

    const existingSession = sessions.find((s) => s.blockId === primaryBlockId && !s.endedAt)
    if (existingSession) {
      const linkedBlockIds = [...(existingSession.linkedBlockIds ?? []), ...secondaryBlockIds]
      const guestCount = 1 + linkedBlockIds.length
      const updatedSession = { ...existingSession, linkedBlockIds, guestCount }
      setSessions((prev) =>
        prev.map((s) => (s.id === existingSession.id ? updatedSession : s))
      )
      upsertSessions([updatedSession], storeId).catch((e) => console.error("[DB]sessions link:", e))
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
        orderItems: [],
        startedAt: now,
        guestCount: 1 + secondaryBlockIds.length,
        linkedBlockIds: secondaryBlockIds,
      }
      setSessions((prev) => [...prev, newSession])
      upsertSessions([newSession], storeId).catch((e) => console.error("[DB]sessions link new:", e))
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

  const handleUnlinkBlock = useCallback((sessionId: string, blockIdToUnlink: string) => {
    const target = sessions.find((s) => s.id === sessionId)
    if (target) {
      const linkedBlockIds = (target.linkedBlockIds ?? []).filter((id) => id !== blockIdToUnlink)
      const newLinkedBlockIds = linkedBlockIds.length > 0 ? linkedBlockIds : undefined
      const guestCount = newLinkedBlockIds ? 1 + newLinkedBlockIds.length : 1
      const updatedSession = { ...target, linkedBlockIds: newLinkedBlockIds, guestCount }
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? updatedSession : s)))
      upsertSessions([updatedSession], storeId).catch((e) => console.error("[DB]sessions unlink:", e))
    }
    setBlocks((prev) =>
      prev.map((b) =>
        b.id === blockIdToUnlink
          ? { ...b, status: "empty", startedAt: undefined }
          : b
      )
    )
  }, [sessions])

  // ── 席移動モード ──────────────────────────────────────────────────────

  const handleEnterMoveMode = useCallback(() => {
    setMoveMode(true)
    setMoveSource(null)
    setMoveDest(null)
    setLinkMode(false)
    setLinkSelection([])
    setSidebarOpen(false)
    setSelectedBlockId(null)
  }, [])

  const handleCancelMoveMode = useCallback(() => {
    setMoveMode(false)
    setMoveSource(null)
    setMoveDest(null)
  }, [])

  const handleMoveBlockSelect = useCallback((blockId: string) => {
    setMoveSource((src) => {
      if (src === null) return blockId        // ステップ1: 移動元を選択
      if (src === blockId) {                  // 移動元を再タップ → 解除
        setMoveDest(null)
        return null
      }
      setMoveDest((dst) => dst === blockId ? null : blockId)  // ステップ2: 移動先をトグル
      return src
    })
  }, [])

  const handleConfirmMove = useCallback(() => {
    if (!moveSource || !moveDest) return

    const sourceSession = sessions.find((s) => s.blockId === moveSource && !s.endedAt)
    if (!sourceSession) return

    const sourceBlock = blocks.find((b) => b.id === moveSource)

    // セッションの blockId を移動先に変更
    setSessions((prev) =>
      prev.map((s) => s.id === sourceSession.id ? { ...s, blockId: moveDest } : s)
    )

    // ブロックのステータスを付け替え
    setBlocks((prev) =>
      prev.map((b) => {
        if (b.id === moveSource) return { ...b, status: "empty", startedAt: undefined }
        if (b.id === moveDest) return { ...b, status: sourceBlock?.status ?? "occupied", startedAt: sourceBlock?.startedAt }
        return b
      })
    )

    setCustomerNames((prev) => { const next = { ...prev }; delete next[moveSource]; return next })
    setMoveMode(false)
    setMoveSource(null)
    setMoveDest(null)
  }, [moveSource, moveDest, sessions, blocks])

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
        ...deleted.map((p) => deleteProduct(p.id)),
        ...added.map((p) => createProduct(p, storeId)),
        ...changed.map((p) => updateProduct(p.id, { name: p.name, price: p.price, isActive: p.isActive, category: p.category })),
      ])
    } catch (err) {
      console.error("商品更新エラー:", err)
      setProducts(prev) // ロールバック
      setDbError("商品の保存に失敗しました")
    }
  }, [products])

  return (
    <div className="flex h-screen flex-col bg-background">
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
                {moveSource === null ? "移動元の席をタップ" : "移動先の空席をタップ"}
              </span>
              {moveSource && moveDest && (
                <Button size="sm" className="ml-auto bg-success text-primary-foreground hover:bg-success/90 sm:ml-1" onClick={handleConfirmMove}>移動する</Button>
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
            moveSource={moveSource}
            moveDest={moveDest}
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
            payments={payments}
            settings={settings}
            products={products}
            coupons={coupons}
            expenses={expenses}
            onCancelPayment={handleCancelPayment}
            onUpdateSettings={setSettings}
            onUpdateProducts={handleUpdateProducts}
            onUpdateCoupons={setCoupons}
            onMarkPaymentsSynced={handleMarkPaymentsSynced}
            onUpsertExpense={handleUpsertExpense}
          />
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
