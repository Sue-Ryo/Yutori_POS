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
import { fetchProducts, createProduct, updateProduct, deleteProduct } from "@/lib/api/products"
import { FloorMap } from "./floor-map"
import { OrderSidebar } from "./order-sidebar"
import { LayoutEditor } from "./layout-editor"
import { AdminReport } from "./admin-report"
import { Button } from "@/components/ui/button"
import { LayoutGrid, Edit3, BarChart3, UtensilsCrossed, RefreshCw } from "lucide-react"

// 目黒店の store_id
const STORE_ID = 1

type Tab = "map" | "editor" | "report"

export function POSSystem() {
  const [activeTab, setActiveTab] = useState<Tab>("map")
  const initializedRef = useRef(false)

  const [blocks, setBlocks] = useState<ServiceBlock[]>(initialBlocks)
  const [layoutElements, setLayoutElements] = useState<LayoutElement[]>(initialLayoutElements)
  const [sessions, setSessions] = useState<BlockSession[]>(initialSessions)
  const [payments, setPayments] = useState<Payment[]>(initialPayments)
  const [settings, setSettings] = useState<BusinessSettings>(initialSettings)
  const [products, setProducts] = useState<Product[]>(initialProducts)
  const [coupons, setCoupons] = useState<Coupon[]>(initialCoupons)
  const [dbLoading, setDbLoading] = useState(false)
  const [dbError, setDbError] = useState<string | null>(null)

  // Supabase から商品データを取得
  const loadProductsFromDB = useCallback(() => {
    setDbLoading(true)
    return fetchProducts()
      .then((fetchedProducts) => {
        console.log(`[POSSystem] DB商品数: ${fetchedProducts.length}`)
        setProducts(fetchedProducts) // 0件でも上書き（初期サンプルをクリア）
      })
      .catch((err) => {
        console.error("商品データ取得エラー:", err)
        setDbError("商品データの取得に失敗しました")
      })
      .finally(() => setDbLoading(false))
  }, [])

  useEffect(() => {
    loadProductsFromDB()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 状態変化時に localStorage へ保存（初期ロード後のみ）
  // ※ このsave effectsは必ずloadEffectより前に定義すること（effect実行順序に依存）
  useEffect(() => { if (initializedRef.current) saveList(STORAGE_KEYS.blocks, blocks) }, [blocks])
  useEffect(() => { if (initializedRef.current) saveList(STORAGE_KEYS.layoutElements, layoutElements) }, [layoutElements])
  useEffect(() => { if (initializedRef.current) saveList(STORAGE_KEYS.sessions, sessions) }, [sessions])
  useEffect(() => { if (initializedRef.current) saveList(STORAGE_KEYS.payments, payments) }, [payments])
  useEffect(() => { if (initializedRef.current) saveObject(STORAGE_KEYS.settings, settings) }, [settings])
  useEffect(() => { if (initializedRef.current) saveList(STORAGE_KEYS.coupons, coupons) }, [coupons])

  // localStorage から読み込む（クライアントサイドのみ・save effectsより後に定義すること）
  useEffect(() => {
    const savedBlocks = loadList(STORAGE_KEYS.blocks, revivers.reviveBlock)
    const savedElements = loadList(STORAGE_KEYS.layoutElements, (r) => r as unknown as LayoutElement)
    const savedSessions = loadList(STORAGE_KEYS.sessions, revivers.reviveSession)
    const savedPayments = loadList(STORAGE_KEYS.payments, revivers.revivePayment)
    const savedSettings = loadObject<BusinessSettings>(STORAGE_KEYS.settings)
    const savedCoupons = loadList(STORAGE_KEYS.coupons, (r) => r as unknown as Coupon)
    if (savedBlocks) setBlocks(savedBlocks)
    if (savedElements) setLayoutElements(savedElements)
    if (savedSessions) setSessions(savedSessions)
    if (savedPayments) setPayments(savedPayments)
    if (savedSettings) setSettings(savedSettings)
    if (savedCoupons) setCoupons(savedCoupons)
    initializedRef.current = true
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [linkMode, setLinkMode] = useState(false)
  const [linkSelection, setLinkSelection] = useState<string[]>([])

  const selectedBlock = selectedBlockId ? blocks.find((b) => b.id === selectedBlockId) ?? null : null
  const currentSession = selectedBlockId
    ? sessions.find((s) => s.blockId === selectedBlockId && !s.endedAt) ?? null
    : null

  // 会計済ブロックの自動クリアタイマー
  useEffect(() => {
    const checkedOutBlocks = blocks.filter((b) => b.status === "checked_out" && b.checkedOutAt)
    if (checkedOutBlocks.length === 0) return

    const id = setInterval(() => {
      const now = Date.now()
      setBlocks((prev) =>
        prev.map((b) => {
          if (b.status === "checked_out" && b.checkedOutAt) {
            const elapsed = (now - b.checkedOutAt.getTime()) / 1000
            if (elapsed >= settings.checkedOutDisplaySeconds) {
              return { ...b, status: "empty", startedAt: undefined, checkedOutAt: undefined }
            }
          }
          return b
        })
      )
    }, 1000)

    return () => clearInterval(id)
  }, [blocks, settings.checkedOutDisplaySeconds])

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

  const handleUpdateSession = useCallback(
    (updatedSession: BlockSession) => {
      setSessions((prev) => {
        const exists = prev.find((s) => s.id === updatedSession.id)
        if (exists) {
          return prev.map((s) => (s.id === updatedSession.id ? updatedSession : s))
        }
        return [...prev, updatedSession]
      })

      const unpaidItems = updatedSession.orderItems.filter((i) => !i.isPaid)
      const hasUnserved = unpaidItems.some((i) => i.servingStatus === "unserved")
      const hasItems = unpaidItems.length > 0
      const status = hasItems ? (hasUnserved ? "waiting" : "occupied") : "empty"
      // プライマリ + 連結ブロック全てのステータスを更新
      const allBlockIds = [updatedSession.blockId, ...(updatedSession.linkedBlockIds ?? [])]
      setBlocks((prev) =>
        prev.map((b) => {
          if (!allBlockIds.includes(b.id)) return b
          const startedAt = b.startedAt ?? updatedSession.startedAt
          return { ...b, status, startedAt }
        })
      )
    },
    []
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
          return { ...b, status: remaining.length > 0 ? (hasUnserved ? "waiting" : "occupied") : "empty" }
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
    setLinkSelection((prev) =>
      prev.includes(blockId) ? prev.filter((id) => id !== blockId) : [...prev, blockId]
    )
  }, [])

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
      setSessions((prev) =>
        prev.map((s) => (s.id === existingSession.id ? { ...s, linkedBlockIds } : s))
      )
    } else {
      const newSession: BlockSession = {
        id: `s-${Date.now()}`,
        blockId: primaryBlockId,
        orderItems: [],
        startedAt: now,
        guestCount: 1,
        linkedBlockIds: secondaryBlockIds,
      }
      setSessions((prev) => [...prev, newSession])
      setBlocks((prev) =>
        prev.map((b) =>
          b.id === primaryBlockId ? { ...b, status: "occupied", startedAt: now } : b
        )
      )
    }

    setBlocks((prev) =>
      prev.map((b) =>
        secondaryBlockIds.includes(b.id)
          ? { ...b, status: "occupied", startedAt: b.startedAt ?? now }
          : b
      )
    )

    setLinkMode(false)
    setLinkSelection([])
  }, [linkSelection, sessions])

  const handleUnlinkBlock = useCallback((sessionId: string, blockIdToUnlink: string) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== sessionId) return s
        const linkedBlockIds = (s.linkedBlockIds ?? []).filter((id) => id !== blockIdToUnlink)
        return { ...s, linkedBlockIds: linkedBlockIds.length > 0 ? linkedBlockIds : undefined }
      })
    )
    setBlocks((prev) =>
      prev.map((b) =>
        b.id === blockIdToUnlink
          ? { ...b, status: "empty", startedAt: undefined }
          : b
      )
    )
  }, [])

  const handleSaveLayout = useCallback(
    (newBlocks: ServiceBlock[], newElements: LayoutElement[]) => {
      setBlocks(newBlocks)
      setLayoutElements(newElements)
      setActiveTab("map")
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
        ...added.map((p) => createProduct(p)),
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
      <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <UtensilsCrossed className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold">{settings.storeName}</h1>
            <p className="text-xs text-muted-foreground">卓番管理・会計システム</p>
          </div>
        </div>

        <nav className="flex gap-1 rounded-lg bg-muted p-1">
          <Button
            variant="ghost"
            size="sm"
            className={cn("gap-2 rounded-md px-4", activeTab === "map" && "bg-background shadow-sm")}
            onClick={() => setActiveTab("map")}
          >
            <LayoutGrid className="h-4 w-4" />
            <span className="hidden sm:inline">フロア管理</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn("gap-2 rounded-md px-4", activeTab === "editor" && "bg-background shadow-sm")}
            onClick={() => setActiveTab("editor")}
          >
            <Edit3 className="h-4 w-4" />
            <span className="hidden sm:inline">レイアウト編集</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn("gap-2 rounded-md px-4", activeTab === "report" && "bg-background shadow-sm")}
            onClick={() => setActiveTab("report")}
          >
            <BarChart3 className="h-4 w-4" />
            <span className="hidden sm:inline">日計・設定</span>
          </Button>
        </nav>

        <div className="flex w-32 justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            onClick={loadProductsFromDB}
            disabled={dbLoading}
            title="商品データを再読み込み"
          >
            <RefreshCw className={cn("h-4 w-4", dbLoading && "animate-spin")} />
            <span className="hidden sm:inline text-xs">更新</span>
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden p-4">
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
            payments={payments}
            settings={settings}
            products={products}
            coupons={coupons}
            onCancelPayment={handleCancelPayment}
            onUpdateSettings={setSettings}
            onUpdateProducts={handleUpdateProducts}
            onUpdateCoupons={setCoupons}
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
