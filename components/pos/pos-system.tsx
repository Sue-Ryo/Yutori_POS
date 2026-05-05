"use client"

import { useState, useCallback, useEffect } from "react"
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
  initialSettings,
  products as initialProducts,
  coupons as initialCoupons,
  getBusinessDate,
} from "@/lib/pos-store"
import { supabase } from "@/lib/supabase"
import { fetchBlocks, upsertBlock, upsertBlocks, rowToBlock } from "@/lib/api/blocks"
import { fetchSessions, upsertSession, rowToSession } from "@/lib/api/sessions"
import { fetchPayments, upsertPayment, rowToPayment } from "@/lib/api/payments-db"
import { fetchLayoutElements, upsertLayoutElements } from "@/lib/api/layout-db"
import { fetchSettings, upsertSettings } from "@/lib/api/settings-db"
import { fetchCoupons, upsertCoupons } from "@/lib/api/coupons-db"
import { fetchProducts, createProduct, updateProduct, deleteProduct } from "@/lib/api/products"
import { FloorMap } from "./floor-map"
import { OrderSidebar } from "./order-sidebar"
import { LayoutEditor } from "./layout-editor"
import { AdminReport } from "./admin-report"
import { Button } from "@/components/ui/button"
import { LayoutGrid, Edit3, BarChart3, UtensilsCrossed, RefreshCw, Link2 } from "lucide-react"

type Tab = "map" | "editor" | "report"

export function POSSystem() {
  const [activeTab, setActiveTab] = useState<Tab>("map")

  const [blocks, setBlocks] = useState<ServiceBlock[]>(
    initialBlocks.map((b) => ({ ...b, status: "empty" as const, startedAt: undefined, checkedOutAt: undefined }))
  )
  const [layoutElements, setLayoutElements] = useState<LayoutElement[]>(initialLayoutElements)
  const [sessions, setSessions] = useState<BlockSession[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [settings, setSettings] = useState<BusinessSettings>(initialSettings)
  const [products, setProducts] = useState<Product[]>(initialProducts)
  const [coupons, setCoupons] = useState<Coupon[]>(initialCoupons)
  const [dbLoading, setDbLoading] = useState(false)
  const [dbError, setDbError] = useState<string | null>(null)

  // ── 初期ロード (Supabase) ────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      fetchBlocks(),
      fetchSessions(),
      fetchPayments(),
      fetchLayoutElements(),
      fetchSettings(),
      fetchCoupons(),
      fetchProducts(),
    ])
      .then(([b, s, p, le, st, c, prod]) => {
        if (b.length > 0) {
          setBlocks(b)
        } else {
          // 初回起動: 初期ブロックを空席状態でシード
          const seed = initialBlocks.map((bl) => ({
            ...bl,
            status: "empty" as const,
            startedAt: undefined,
            checkedOutAt: undefined,
          }))
          setBlocks(seed)
          upsertBlocks(seed).catch(console.error)
        }
        setSessions(s)
        setPayments(p)
        if (le.length > 0) {
          setLayoutElements(le)
        } else {
          upsertLayoutElements(initialLayoutElements).catch(console.error)
        }
        if (st) setSettings(st)
        else upsertSettings(initialSettings).catch(console.error)
        if (c.length > 0) setCoupons(c)
        if (prod.length > 0) setProducts(prod)
      })
      .catch((err) => {
        console.error("Supabase initial load error:", err)
        setDbError("データの読み込みに失敗しました")
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Realtime 購読: blocks / sessions / payments ──────────────────────
  useEffect(() => {
    const channel = supabase
      .channel("pos_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "blocks" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            setBlocks((prev) => prev.filter((b) => b.id !== (payload.old as { id: string }).id))
          } else {
            const block = rowToBlock(payload.new as Record<string, unknown>)
            setBlocks((prev) => {
              const idx = prev.findIndex((b) => b.id === block.id)
              if (idx >= 0) {
                const next = [...prev]
                next[idx] = block
                return next
              }
              return [...prev, block]
            })
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sessions" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            setSessions((prev) => prev.filter((s) => s.id !== (payload.old as { id: string }).id))
          } else {
            const session = rowToSession(payload.new as Record<string, unknown>)
            setSessions((prev) => {
              const idx = prev.findIndex((s) => s.id === session.id)
              if (idx >= 0) {
                const next = [...prev]
                next[idx] = session
                return next
              }
              return [...prev, session]
            })
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payments" },
        (payload) => {
          if (payload.eventType !== "DELETE") {
            const payment = rowToPayment(payload.new as Record<string, unknown>)
            setPayments((prev) => {
              const idx = prev.findIndex((p) => p.id === payment.id)
              if (idx >= 0) {
                const next = [...prev]
                next[idx] = payment
                return next
              }
              return [payment, ...prev]
            })
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  // ── 商品データ再読み込み ──────────────────────────────────────────────
  const loadProductsFromDB = useCallback(() => {
    setDbLoading(true)
    return fetchProducts()
      .then((fetched) => {
        if (fetched.length > 0) setProducts(fetched)
      })
      .catch((err) => {
        console.error("商品データ取得エラー:", err)
        setDbError("商品データの取得に失敗しました")
      })
      .finally(() => setDbLoading(false))
  }, [])

  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [linkMode, setLinkMode] = useState(false)
  const [linkSelection, setLinkSelection] = useState<string[]>([])
  const [moveMode, setMoveMode] = useState(false)
  const [moveSource, setMoveSource] = useState<string | null>(null)
  const [moveDest, setMoveDest] = useState<string | null>(null)

  const selectedBlock = selectedBlockId ? blocks.find((b) => b.id === selectedBlockId) ?? null : null
  const currentSession = selectedBlockId
    ? sessions.find((s) => s.blockId === selectedBlockId && !s.endedAt) ?? null
    : null

  const handleBlockClick = useCallback(
    (blockId: string) => {
      const ownerSession = sessions.find(
        (s) => !s.endedAt && (s.linkedBlockIds ?? []).includes(blockId)
      )
      setSelectedBlockId(ownerSession ? ownerSession.blockId : blockId)
      setSidebarOpen(true)
    },
    [sessions]
  )

  const handleCloseSidebar = useCallback(() => {
    setSidebarOpen(false)
    setSelectedBlockId(null)
  }, [])

  const handleToggleReserved = useCallback(() => {
    if (!selectedBlockId) return
    const target = blocks.find((b) => b.id === selectedBlockId)
    if (!target) return
    const updated = { ...target, status: (target.status === "reserved" ? "empty" : "reserved") as ServiceBlock["status"] }
    setBlocks((prev) => prev.map((b) => (b.id === selectedBlockId ? updated : b)))
    upsertBlock(updated).catch(console.error)
  }, [selectedBlockId, blocks])

  const handleBussingComplete = useCallback(() => {
    if (!selectedBlockId) return

    const endedSession = sessions.find(
      (s) =>
        (s.blockId === selectedBlockId || (s.linkedBlockIds ?? []).includes(selectedBlockId)) &&
        s.endedAt
    )
    const allBlockIds = endedSession
      ? [endedSession.blockId, ...(endedSession.linkedBlockIds ?? [])]
      : [selectedBlockId]

    const changedBlocks = blocks
      .filter((b) => allBlockIds.includes(b.id))
      .map((b) => ({ ...b, status: "empty" as const, startedAt: undefined, checkedOutAt: undefined }))

    setBlocks((prev) =>
      prev.map((b) => changedBlocks.find((c) => c.id === b.id) ?? b)
    )
    upsertBlocks(changedBlocks).catch(console.error)
    handleCloseSidebar()
  }, [selectedBlockId, sessions, blocks, handleCloseSidebar])

  const handleUpdateSession = useCallback(
    (updatedSession: BlockSession) => {
      setSessions((prev) => {
        const exists = prev.find((s) => s.id === updatedSession.id)
        return exists
          ? prev.map((s) => (s.id === updatedSession.id ? updatedSession : s))
          : [...prev, updatedSession]
      })
      upsertSession(updatedSession).catch(console.error)

      const unpaidItems = updatedSession.orderItems.filter((i) => !i.isPaid)
      const status = unpaidItems.length > 0 ? "occupied" : "empty"
      const allBlockIds = [updatedSession.blockId, ...(updatedSession.linkedBlockIds ?? [])]
      const changedBlocks = blocks
        .filter((b) => allBlockIds.includes(b.id))
        .map((b) => ({
          ...b,
          status: status as ServiceBlock["status"],
          startedAt: b.startedAt ?? updatedSession.startedAt,
        }))
      setBlocks((prev) => prev.map((b) => changedBlocks.find((c) => c.id === b.id) ?? b))
      upsertBlocks(changedBlocks).catch(console.error)
    },
    [blocks]
  )

  const handleCheckout = useCallback(
    (sessionId: string, data: CheckoutData) => {
      const session = sessions.find((s) => s.id === sessionId)
      if (!session) return

      const now = new Date()
      const businessDate = getBusinessDate(now, settings.businessDayStartTime)

      const targetItemIds =
        data.paidItemIds.length > 0
          ? data.paidItemIds
          : session.orderItems.filter((i) => !i.isPaid).map((i) => i.id)

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
      upsertPayment(newPayment).catch(console.error)

      const updatedItems = session.orderItems.map((i) =>
        targetItemIds.includes(i.id) ? { ...i, isPaid: true, paidAt: now } : i
      )
      const allPaid = updatedItems.every((i) => i.isPaid)
      const updatedSession: BlockSession = {
        ...session,
        orderItems: updatedItems,
        guestCount: data.guestCount,
        endedAt: allPaid ? now : undefined,
      }
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? updatedSession : s)))
      upsertSession(updatedSession).catch(console.error)

      const allBlockIds = [session.blockId, ...(session.linkedBlockIds ?? [])]
      const changedBlocks = blocks
        .filter((b) => allBlockIds.includes(b.id))
        .map((b) => {
          if (allPaid) return { ...b, status: "checked_out" as const, checkedOutAt: now }
          const remaining = updatedItems.filter((i) => !i.isPaid)
          return { ...b, status: (remaining.length > 0 ? "occupied" : "empty") as ServiceBlock["status"] }
        })
      setBlocks((prev) => prev.map((b) => changedBlocks.find((c) => c.id === b.id) ?? b))
      upsertBlocks(changedBlocks).catch(console.error)

      handleCloseSidebar()
    },
    [sessions, blocks, settings.businessDayStartTime, handleCloseSidebar]
  )

  const handleCancelPayment = useCallback(
    (paymentId: string) => {
      const payment = payments.find((p) => p.id === paymentId)
      if (!payment || payment.canceledAt) return

      const now = new Date()
      const canceledPayment = { ...payment, canceledAt: now }
      setPayments((prev) => prev.map((p) => (p.id === paymentId ? canceledPayment : p)))
      upsertPayment(canceledPayment).catch(console.error)

      const targetSession = sessions.find((s) => s.id === payment.sessionId)
      if (targetSession) {
        const updatedSession = {
          ...targetSession,
          orderItems: targetSession.orderItems.map((i) =>
            payment.paidItemIds.includes(i.id) ? { ...i, isPaid: false, paidAt: undefined } : i
          ),
          endedAt: undefined,
        }
        setSessions((prev) => prev.map((s) => (s.id === payment.sessionId ? updatedSession : s)))
        upsertSession(updatedSession).catch(console.error)
      }

      const allCancelBlockIds = [payment.blockId, ...(targetSession?.linkedBlockIds ?? [])]
      const changedBlocks = blocks
        .filter((b) => allCancelBlockIds.includes(b.id))
        .map((b) => ({ ...b, status: "occupied" as const, checkedOutAt: undefined }))
      setBlocks((prev) => prev.map((b) => changedBlocks.find((c) => c.id === b.id) ?? b))
      upsertBlocks(changedBlocks).catch(console.error)
    },
    [payments, sessions, blocks]
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
    const primaryBlockId =
      linkSelection.find((id) => sessions.some((s) => s.blockId === id && !s.endedAt)) ??
      linkSelection[0]
    const secondaryBlockIds = linkSelection.filter((id) => id !== primaryBlockId)

    const primarySession = sessions.find((s) => s.blockId === primaryBlockId && !s.endedAt)
    const secondarySessions = secondaryBlockIds
      .map((id) => sessions.find((s) => s.blockId === id && !s.endedAt))
      .filter(Boolean) as BlockSession[]

    const hasSecondaryOrders = secondarySessions.some((s) => s.orderItems.length > 0)

    const buildMergedItems = (base: BlockSession | undefined) => {
      const primaryItems = (base?.orderItems ?? []).map((i) =>
        hasSecondaryOrders ? { ...i, originBlockId: i.originBlockId ?? primaryBlockId } : i
      )
      const secondaryItems = secondarySessions.flatMap((s) =>
        s.orderItems.map((i) => ({ ...i, originBlockId: i.originBlockId ?? s.blockId }))
      )
      return [...primaryItems, ...secondaryItems]
    }

    // セカンダリセッションを終了
    const endedSessions: BlockSession[] = []
    if (secondarySessions.length > 0) {
      const updated = sessions.map((s) => {
        if (secondaryBlockIds.includes(s.blockId) && !s.endedAt) {
          const ended = { ...s, endedAt: now }
          endedSessions.push(ended)
          return ended
        }
        return s
      })
      setSessions(updated)
      endedSessions.forEach((s) => upsertSession(s).catch(console.error))
    }

    const totalSeatCount = linkSelection.length // 連結席数 = 来客人数として自動セット

    let updatedPrimary: BlockSession | null = null
    if (primarySession) {
      const linkedBlockIds = [...(primarySession.linkedBlockIds ?? []), ...secondaryBlockIds]
      const mergedItems = buildMergedItems(primarySession)
      updatedPrimary = { ...primarySession, linkedBlockIds, orderItems: mergedItems, guestCount: totalSeatCount }
      setSessions((prev) =>
        prev.map((s) => (s.id === primarySession.id ? updatedPrimary! : s))
      )
      upsertSession(updatedPrimary).catch(console.error)
    } else {
      const mergedItems = buildMergedItems(undefined)
      updatedPrimary = {
        id: `s-${Date.now()}`,
        blockId: primaryBlockId,
        orderItems: mergedItems,
        startedAt: now,
        guestCount: totalSeatCount,
        linkedBlockIds: secondaryBlockIds,
      }
      setSessions((prev) => [...prev, updatedPrimary!])
      upsertSession(updatedPrimary).catch(console.error)
    }

    // ブロックステータス更新
    const allLinkIds = linkSelection
    const changedBlocks = blocks
      .filter((b) => allLinkIds.includes(b.id))
      .map((b) => ({
        ...b,
        status: "occupied" as const,
        startedAt: b.startedAt ?? now,
      }))
    setBlocks((prev) => prev.map((b) => changedBlocks.find((c) => c.id === b.id) ?? b))
    upsertBlocks(changedBlocks).catch(console.error)

    setLinkMode(false)
    setLinkSelection([])
  }, [linkSelection, sessions, blocks])

  const handleUnlinkBlock = useCallback(
    (sessionId: string, blockIdToUnlink: string) => {
      const targetSession = sessions.find((s) => s.id === sessionId)
      if (!targetSession) return
      const linkedBlockIds = (targetSession.linkedBlockIds ?? []).filter((id) => id !== blockIdToUnlink)
      const updatedSession = {
        ...targetSession,
        linkedBlockIds: linkedBlockIds.length > 0 ? linkedBlockIds : undefined,
      }
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? updatedSession : s)))
      upsertSession(updatedSession).catch(console.error)

      const unlinkedBlock = blocks.find((b) => b.id === blockIdToUnlink)
      if (unlinkedBlock) {
        const updated = { ...unlinkedBlock, status: "empty" as const, startedAt: undefined }
        setBlocks((prev) => prev.map((b) => (b.id === blockIdToUnlink ? updated : b)))
        upsertBlock(updated).catch(console.error)
      }
    },
    [sessions, blocks]
  )

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
      if (src === null) return blockId
      if (src === blockId) {
        setMoveDest(null)
        return null
      }
      setMoveDest((dst) => (dst === blockId ? null : blockId))
      return src
    })
  }, [])

  const handleConfirmMove = useCallback(() => {
    if (!moveSource || !moveDest) return

    const sourceSession = sessions.find((s) => s.blockId === moveSource && !s.endedAt)
    if (!sourceSession) return

    const sourceBlock = blocks.find((b) => b.id === moveSource)
    const destBlock = blocks.find((b) => b.id === moveDest)
    if (!destBlock) return

    const updatedSession = { ...sourceSession, blockId: moveDest }
    setSessions((prev) => prev.map((s) => (s.id === sourceSession.id ? updatedSession : s)))
    upsertSession(updatedSession).catch(console.error)

    const clearedSource = { ...sourceBlock!, status: "empty" as const, startedAt: undefined }
    const movedDest = {
      ...destBlock,
      status: (sourceBlock?.status ?? "occupied") as ServiceBlock["status"],
      startedAt: sourceBlock?.startedAt,
    }
    setBlocks((prev) =>
      prev.map((b) => {
        if (b.id === moveSource) return clearedSource
        if (b.id === moveDest) return movedDest
        return b
      })
    )
    upsertBlocks([clearedSource, movedDest]).catch(console.error)

    setMoveMode(false)
    setMoveSource(null)
    setMoveDest(null)
  }, [moveSource, moveDest, sessions, blocks])

  const handleSaveLayout = useCallback(
    (newBlocks: ServiceBlock[], newElements: LayoutElement[]) => {
      setBlocks(newBlocks)
      setLayoutElements(newElements)
      upsertBlocks(newBlocks).catch(console.error)
      upsertLayoutElements(newElements).catch(console.error)
      setActiveTab("map")
    },
    []
  )

  // ── 設定・クーポン更新 ────────────────────────────────────────────────

  const handleUpdateSettings = useCallback((newSettings: BusinessSettings) => {
    setSettings(newSettings)
    upsertSettings(newSettings).catch(console.error)
  }, [])

  const handleUpdateCoupons = useCallback((newCoupons: Coupon[]) => {
    setCoupons(newCoupons)
    upsertCoupons(newCoupons).catch(console.error)
  }, [])

  // ── 商品マスタ: Supabase 連携ハンドラ ────────────────────────────────

  const handleUpdateProducts = useCallback(
    async (updated: Product[]) => {
      const prev = products
      const deleted = prev.filter((p) => !updated.find((u) => u.id === p.id))
      const added = updated.filter((u) => !prev.find((p) => p.id === u.id))
      const changed = updated.filter((u) => {
        const old = prev.find((p) => p.id === u.id)
        return (
          old &&
          (old.name !== u.name ||
            old.price !== u.price ||
            old.isActive !== u.isActive ||
            old.category !== u.category)
        )
      })

      setProducts(updated)

      try {
        await Promise.all([
          ...deleted.map((p) => deleteProduct(p.id)),
          ...added.map((p) => createProduct(p)),
          ...changed.map((p) =>
            updateProduct(p.id, {
              name: p.name,
              price: p.price,
              isActive: p.isActive,
              category: p.category,
            })
          ),
        ])
      } catch (err) {
        console.error("商品更新エラー:", err)
        setProducts(prev)
        setDbError("商品の保存に失敗しました")
      }
    },
    [products]
  )

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border bg-card">
        <div className="flex items-center justify-between px-4 py-3">
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
        </div>

        {/* フロア管理タブのみ: 席ステータス凡例 */}
        {activeTab === "map" && (
          <div className="flex items-center gap-4 border-t border-border/50 px-4 py-1.5">
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded bg-table-empty" />
              <span className="text-xs text-muted-foreground">空席</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded bg-table-reserved" />
              <span className="text-xs text-muted-foreground">予約</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded bg-table-occupied" />
              <span className="text-xs text-muted-foreground">使用中</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded bg-table-checked-out" />
              <span className="text-xs text-muted-foreground">会計済</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Link2 className="h-3 w-3 text-info" />
              <span className="text-xs text-muted-foreground">連結中</span>
            </div>
          </div>
        )}
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
            moveMode={moveMode}
            moveSource={moveSource}
            moveDest={moveDest}
            onEnterMoveMode={handleEnterMoveMode}
            onMoveBlockSelect={handleMoveBlockSelect}
            onConfirmMove={handleConfirmMove}
            onCancelMoveMode={handleCancelMoveMode}
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
            onUpdateSettings={handleUpdateSettings}
            onUpdateProducts={handleUpdateProducts}
            onUpdateCoupons={handleUpdateCoupons}
          />
        )}

        {dbError && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-destructive px-4 py-2 text-sm text-destructive-foreground shadow-lg">
            {dbError}
            <button className="ml-3 underline" onClick={() => setDbError(null)}>
              閉じる
            </button>
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
        onToggleReserved={handleToggleReserved}
      />

      {sidebarOpen && activeTab === "map" && (
        <div className="fixed inset-0 z-40 bg-black/50" onClick={handleCloseSidebar} />
      )}
    </div>
  )
}
