"use client"

import { useState, useMemo, useEffect } from "react"
import { cn } from "@/lib/utils"
import type {
  ServiceBlock,
  BlockSession,
  OrderItem,
  Product,
  Coupon,
  BusinessSettings,
  CheckoutData,
} from "@/lib/pos-types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  X,
  Plus,
  Minus,
  Check,
  Clock,
  CreditCard,
  Banknote,
  Split,
  ChevronDown,
  ChevronUp,
  Trash2,
  MessageSquare,
  Users,
  Link2,
  FileText,
  ShoppingCart,
  Zap,
  CheckCheck,
} from "lucide-react"

const HAPPY_HOUR_CATEGORIES = ["シーシャ", "チャージ", "ドリンク", "システム", "shisha", "system", "drink", "charge"]
const DRINK_CATEGORIES = ["ドリンク", "drink"]
const HAPPY_HOUR_BASE = 3000
const DRINK_THRESHOLD = 600

interface OrderSidebarProps {
  isOpen: boolean
  onClose: () => void
  selectedBlock: ServiceBlock | null
  session: BlockSession | null
  products: Product[]
  coupons: Coupon[]
  settings: BusinessSettings
  blocks: ServiceBlock[]
  onUpdateSession: (session: BlockSession) => void
  onCheckout: (sessionId: string, data: CheckoutData) => void
  onUnlinkBlock: (sessionId: string, blockIdToUnlink: string) => void
  onBussingComplete: () => void
  onReserveBlock: (blockId: string) => void
}

export function OrderSidebar({
  isOpen,
  onClose,
  selectedBlock,
  session,
  products,
  coupons,
  settings,
  blocks,
  onUpdateSession,
  onCheckout,
  onUnlinkBlock,
  onBussingComplete,
  onReserveBlock,
}: OrderSidebarProps) {
  const [showOrderModal, setShowOrderModal] = useState(false)
  const [pendingCounts, setPendingCounts] = useState<Record<string, number>>({})
  const [openCategoryIds, setOpenCategoryIds] = useState<Set<string>>(new Set())
  const [splitMode, setSplitMode] = useState(false)
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])
  const [selectedCouponId, setSelectedCouponId] = useState<string>("")
  const [cashReceived, setCashReceived] = useState<string>("")
  const [guestCount, setGuestCount] = useState<number>(session?.guestCount ?? 1)
  const [editingMemoId, setEditingMemoId] = useState<string | null>(null)
  const [noteText, setNoteText] = useState<string>(session?.note ?? "")
  const [happyHour, setHappyHour] = useState(false)

  useEffect(() => {
    setNoteText(session?.note ?? "")
  }, [session?.id])

  // サイドバーが閉じたらモーダルも閉じる
  useEffect(() => {
    if (!isOpen) {
      setShowOrderModal(false)
      setPendingCounts({})
      setHappyHour(false)
    }
  }, [isOpen])

  const toggleCategory = (catId: string) => {
    setOpenCategoryIds((prev) => {
      const next = new Set(prev)
      next.has(catId) ? next.delete(catId) : next.add(catId)
      return next
    })
  }

  // Rules of Hooks: 条件付き return より前に全 Hook を呼ぶ
  const activeProducts = products.filter((p) => p.isActive)
  const productCategoryMap = useMemo(() => {
    const map: Record<string, string> = {}
    products.forEach((p) => { map[p.id] = p.category })
    return map
  }, [products])
  const sortedCategories = useMemo(() => {
    const seen = new Set<string>()
    const cats: string[] = []
    activeProducts
      .slice()
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .forEach((p) => {
        if (p.category && !seen.has(p.category)) {
          seen.add(p.category)
          cats.push(p.category)
        }
      })
    return cats
  }, [activeProducts])

  if (!selectedBlock) return null

  const unpaidItems = session?.orderItems.filter((i) => !i.isPaid) ?? []

  const targetItems =
    splitMode && selectedItemIds.length > 0
      ? unpaidItems.filter((i) => selectedItemIds.includes(i.id))
      : unpaidItems

  // ハッピーアワー計算（item.category を優先、なければ productCategoryMap にフォールバック）
  const itemCategory = (i: { productId: string; category?: string }) =>
    i.category ?? productCategoryMap[i.productId] ?? ""
  const drinkSubtotal = targetItems
    .filter((i) => DRINK_CATEGORIES.includes(itemCategory(i)))
    .reduce((sum, i) => sum + i.subtotal, 0)
  const nonHhSubtotal = targetItems
    .filter((i) => !HAPPY_HOUR_CATEGORIES.includes(itemCategory(i)))
    .reduce((sum, i) => sum + i.subtotal, 0)
  const drinkPerPerson = guestCount > 0 ? drinkSubtotal / guestCount : 0
  const drinkOveragePerPerson = Math.max(0, drinkPerPerson - DRINK_THRESHOLD)
  const hhPerPerson = HAPPY_HOUR_BASE + drinkOveragePerPerson
  const happyHourCharge = Math.round(hhPerPerson * guestCount)

  const subtotal = happyHour
    ? happyHourCharge + nonHhSubtotal
    : targetItems.reduce((sum, i) => sum + i.subtotal, 0)

  const selectedCoupon = coupons.find((c) => c.id === selectedCouponId && c.isActive)
  const discountAmount = selectedCoupon
    ? selectedCoupon.discountType === "amount"
      ? Math.min(selectedCoupon.discountValue, subtotal)
      : Math.round((subtotal * selectedCoupon.discountValue) / 100)
    : 0

  const taxBase = subtotal - discountAmount
  const taxAmount = Math.round((taxBase * settings.taxRate) / 100)
  const totalAmount = taxBase + taxAmount

  const cashReceivedNum = parseInt(cashReceived, 10) || 0
  const change = cashReceivedNum - totalAmount

  // ── 未確定オーダーの集計 ───────────────────────────────────────────
  const pendingTotal = Object.values(pendingCounts).reduce((sum, qty) => sum + qty, 0)
  const pendingSubtotal = Object.entries(pendingCounts).reduce((sum, [productId, qty]) => {
    const product = activeProducts.find((p) => p.id === productId)
    return sum + (product ? product.price * qty : 0)
  }, 0)

  // ── セッション確保 ────────────────────────────────────────────────
  const ensureSession = (): BlockSession => {
    if (session) return session
    return {
      id: `s-${Date.now()}`,
      blockId: selectedBlock.id,
      orderItems: [],
      startedAt: new Date(),
      guestCount,
      note: noteText || undefined,
    }
  }

  // ── オーダー追加モーダル ──────────────────────────────────────────
  const handleOpenOrderModal = () => {
    setPendingCounts({})
    setOpenCategoryIds(new Set(sortedCategories)) // 全カテゴリを展開
    setShowOrderModal(true)
  }

  const handleCloseOrderModal = () => {
    setPendingCounts({})
    setShowOrderModal(false)
  }

  const handlePendingAdd = (productId: string) => {
    setPendingCounts((prev) => ({ ...prev, [productId]: (prev[productId] || 0) + 1 }))
  }

  const handlePendingAdjust = (productId: string, delta: number) => {
    setPendingCounts((prev) => {
      const newCount = Math.max(0, (prev[productId] || 0) + delta)
      if (newCount === 0) {
        const next = { ...prev }
        delete next[productId]
        return next
      }
      return { ...prev, [productId]: newCount }
    })
  }

  const handleAddItems = (counts: Record<string, number>) => {
    const s = ensureSession()
    let updatedItems = [...s.orderItems]
    const now = new Date()

    for (const [productId, quantity] of Object.entries(counts)) {
      if (quantity <= 0) continue
      const product = activeProducts.find((p) => p.id === productId)
      if (!product) continue

      const existing = updatedItems.find(
        (i) => i.productId === productId && !i.isPaid && !i.optionMemo,
      )
      if (existing) {
        updatedItems = updatedItems.map((i) =>
          i.id === existing.id
            ? {
                ...i,
                quantity: i.quantity + quantity,
                subtotal: (i.quantity + quantity) * i.price,
              }
            : i,
        )
      } else {
        const newItem: OrderItem = {
          id: `i-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          productId,
          category: product.category,
          name: product.name,
          price: product.price,
          quantity,
          subtotal: product.price * quantity,
          servingStatus: "unserved",
          orderedAt: now,
          isPaid: false,
        }
        updatedItems = [...updatedItems, newItem]
      }
    }

    onUpdateSession({ ...s, orderItems: updatedItems, guestCount })
  }

  const handleConfirmOrder = () => {
    const counts = Object.fromEntries(Object.entries(pendingCounts).filter(([, qty]) => qty > 0))
    if (Object.keys(counts).length === 0) return
    handleAddItems(counts)
    setPendingCounts({})
    setShowOrderModal(false)
  }

  // ── 既存注文の操作 ────────────────────────────────────────────────
  const handleQuantityChange = (itemId: string, delta: number) => {
    if (!session) return
    const updatedItems = session.orderItems
      .map((i) =>
        i.id === itemId
          ? {
              ...i,
              quantity: Math.max(0, i.quantity + delta),
              subtotal: Math.max(0, i.quantity + delta) * i.price,
            }
          : i,
      )
      .filter((i) => i.quantity > 0)
    onUpdateSession({ ...session, orderItems: updatedItems })
  }

  const handleUpdateMemo = (itemId: string, memo: string) => {
    if (!session) return
    const updatedItems = session.orderItems.map((i) =>
      i.id === itemId ? { ...i, optionMemo: memo } : i,
    )
    onUpdateSession({ ...session, orderItems: updatedItems })
  }

  const handleCancelItem = (itemId: string) => {
    if (!session) return
    const updatedItems = session.orderItems.filter((i) => i.id !== itemId)
    onUpdateSession({ ...session, orderItems: updatedItems })
  }

  const handleSplitToggle = (itemId: string) => {
    setSelectedItemIds((prev) =>
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId],
    )
  }

  const handleCheckoutCash = () => {
    if (!session) return
    const paidItemIds = splitMode && selectedItemIds.length > 0 ? selectedItemIds : []
    onCheckout(session.id, {
      cashAmount: totalAmount,
      cashlessAmount: 0,
      discountAmount,
      taxAmount,
      totalAmount,
      couponId: selectedCouponId || undefined,
      guestCount,
      paidItemIds,
    })
    resetCheckoutState()
  }

  const handleCheckoutCashless = () => {
    if (!session) return
    const paidItemIds = splitMode && selectedItemIds.length > 0 ? selectedItemIds : []
    onCheckout(session.id, {
      cashAmount: 0,
      cashlessAmount: totalAmount,
      discountAmount,
      taxAmount,
      totalAmount,
      couponId: selectedCouponId || undefined,
      guestCount,
      paidItemIds,
    })
    resetCheckoutState()
  }

  const resetCheckoutState = () => {
    setSplitMode(false)
    setSelectedItemIds([])
    setSelectedCouponId("")
    setCashReceived("")
  }

  const formatTime = (d: Date) =>
    d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })

  const totalOrderedQty = unpaidItems.reduce((s, i) => s + i.quantity, 0)

  return (
    <>
      {/* ── サイドバー ─────────────────────────────────────────────── */}
      <div
        className={cn(
          "fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-xl transition-transform duration-300",
          isOpen ? "translate-x-0" : "translate-x-full",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex-1">
            <h2 className="text-lg font-bold">{selectedBlock.name}</h2>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              {session && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatTime(session.startedAt)}〜
                </span>
              )}
              <div className="flex items-center gap-1">
                <Users className="h-3 w-3" />
                <Input
                  type="number"
                  value={guestCount}
                  onChange={(e) => {
                    const n = Math.max(1, parseInt(e.target.value) || 1)
                    setGuestCount(n)
                    if (session) onUpdateSession({ ...session, guestCount: n })
                  }}
                  className="h-6 w-14 border-0 bg-transparent p-0 text-sm"
                  min={1}
                />
                <span>名</span>
              </div>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <FileText className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
              <input
                type="text"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                onBlur={() => {
                  if (session) onUpdateSession({ ...session, note: noteText || undefined })
                }}
                placeholder="備考を追加..."
                className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/50 outline-none"
              />
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* 連結席セクション */}
        {session && (session.linkedBlockIds ?? []).length > 0 && (
          <div className="border-b border-border px-4 py-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Link2 className="h-3 w-3" />
                連結席
              </span>
              {(session.linkedBlockIds ?? []).map((linkedId) => {
                const lb = blocks.find((b) => b.id === linkedId)
                if (!lb) return null
                return (
                  <span
                    key={linkedId}
                    className="flex items-center gap-1 rounded-full bg-info/20 px-2 py-0.5 text-xs"
                  >
                    {lb.name}
                    <button
                      onClick={() => onUnlinkBlock(session.id, linkedId)}
                      className="ml-0.5 text-muted-foreground hover:text-destructive"
                      title="連結解除"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                )
              })}
            </div>
          </div>
        )}

        {/* 注文内容エリア */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* オーダー追加ボタン */}
          <div className="mb-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-semibold">注文内容</h3>
              {totalOrderedQty > 0 && (
                <span className="text-xs text-muted-foreground">{totalOrderedQty}点</span>
              )}
            </div>
            <button
              onClick={handleOpenOrderModal}
              className="group relative flex w-full items-center justify-center gap-2.5 overflow-hidden rounded-xl bg-primary px-4 py-3.5 font-bold text-primary-foreground shadow-md transition-all active:scale-[0.98] hover:bg-primary/90 hover:shadow-lg"
            >
              <ShoppingCart className="h-5 w-5 transition-transform group-hover:scale-110" />
              <span className="text-base">オーダー追加</span>
              <span className="absolute right-3 flex h-6 w-6 items-center justify-center rounded-full bg-primary-foreground/20 text-xs font-bold">
                <Plus className="h-3.5 w-3.5" />
              </span>
            </button>
          </div>

          {/* 注文リスト */}
          {unpaidItems.length > 0 ? (
            <div className="space-y-2">
              {unpaidItems.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    "rounded-lg border border-border p-3 transition-colors",
                    splitMode && selectedItemIds.includes(item.id) && "border-primary bg-primary/10",
                  )}
                  onClick={() => splitMode && handleSplitToggle(item.id)}
                >
                  <div className="flex items-start gap-2">
                    {splitMode && (
                      <input
                        type="checkbox"
                        checked={selectedItemIds.includes(item.id)}
                        onChange={() => handleSplitToggle(item.id)}
                        className="mt-0.5 h-4 w-4"
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <p className="truncate font-medium text-sm">{item.name}</p>
                          {happyHour && HAPPY_HOUR_CATEGORIES.includes(itemCategory(item)) && (
                            <span className="shrink-0 rounded bg-orange-500 px-1 py-0.5 text-[10px] font-bold text-white">HH</span>
                          )}
                        </div>
                        <span className="whitespace-nowrap text-xs text-muted-foreground">
                          {formatTime(item.orderedAt)}
                        </span>
                      </div>
                      {happyHour && HAPPY_HOUR_CATEGORIES.includes(itemCategory(item)) ? (
                        <p className="text-xs text-muted-foreground line-through">
                          ¥{item.price.toLocaleString()} × {item.quantity} = ¥{item.subtotal.toLocaleString()}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          ¥{item.price.toLocaleString()} × {item.quantity} = ¥
                          {item.subtotal.toLocaleString()}
                        </p>
                      )}
                      {editingMemoId === item.id ? (
                        <div className="mt-1 flex gap-1" onClick={(e) => e.stopPropagation()}>
                          <Input
                            autoFocus
                            defaultValue={item.optionMemo ?? ""}
                            placeholder="例: 氷少なめ"
                            className="h-7 text-xs"
                            onBlur={(e) => {
                              handleUpdateMemo(item.id, e.target.value)
                              setEditingMemoId(null)
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                handleUpdateMemo(item.id, e.currentTarget.value)
                                setEditingMemoId(null)
                              }
                            }}
                          />
                        </div>
                      ) : (
                        <button
                          className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditingMemoId(item.id)
                          }}
                        >
                          <MessageSquare className="h-2.5 w-2.5" />
                          {item.optionMemo ? item.optionMemo : "メモ追加"}
                        </button>
                      )}
                    </div>
                  </div>

                  <div
                    className="mt-2 flex items-center justify-between gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handleQuantityChange(item.id, -1)}
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="w-6 text-center font-bold text-sm">{item.quantity}</span>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handleQuantityChange(item.id, 1)}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => handleCancelItem(item.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-border">
              <p className="text-sm text-muted-foreground">注文がありません</p>
            </div>
          )}
        </div>

        {/* 会計エリア */}
        <div className="space-y-3 border-t border-border p-4">
          {/* ハッピーアワートグル */}
          <Button
            variant={happyHour ? "default" : "outline"}
            size="sm"
            className={cn(
              "w-full",
              happyHour
                ? "bg-amber-500 hover:bg-amber-500/90 text-white border-amber-500"
                : "border-amber-400 text-amber-600 hover:bg-amber-50",
            )}
            onClick={() => setHappyHour(!happyHour)}
          >
            <Zap className={cn("mr-1.5 h-4 w-4", happyHour && "fill-white")} />
            {happyHour ? `ハッピーアワー適用中 (¥${Math.round(hhPerPerson).toLocaleString()}/人)` : "ハッピーアワー"}
          </Button>

          <div className="flex gap-2">
            <Button
              variant={splitMode ? "default" : "outline"}
              size="sm"
              className={cn("flex-1", splitMode && "bg-info")}
              onClick={() => {
                setSplitMode(!splitMode)
                setSelectedItemIds([])
              }}
            >
              <Split className="mr-1 h-4 w-4" />
              {splitMode ? `${selectedItemIds.length}品選択中` : "個別会計"}
            </Button>
            <select
              className="flex-1 rounded-md border border-border bg-background px-2 text-sm"
              value={selectedCouponId}
              onChange={(e) => setSelectedCouponId(e.target.value)}
            >
              <option value="">クーポンなし</option>
              {coupons
                .filter((c) => c.isActive)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}（
                    {c.discountType === "amount"
                      ? `−¥${c.discountValue.toLocaleString()}`
                      : `−${c.discountValue}%`}
                    ）
                  </option>
                ))}
            </select>
          </div>

          <div className="space-y-1 rounded-lg bg-muted p-3 text-sm">
            {happyHour ? (
              <>
                <div className="flex justify-between text-amber-600 dark:text-amber-400">
                  <span>HH基本 (¥{HAPPY_HOUR_BASE.toLocaleString()} × {guestCount}名)</span>
                  <span>¥{(HAPPY_HOUR_BASE * guestCount).toLocaleString()}</span>
                </div>
                {drinkOveragePerPerson > 0 && (
                  <div className="flex justify-between text-amber-600 dark:text-amber-400">
                    <span>ドリンク超過 (+¥{Math.round(drinkOveragePerPerson).toLocaleString()}/人 × {guestCount}名)</span>
                    <span>¥{Math.round(drinkOveragePerPerson * guestCount).toLocaleString()}</span>
                  </div>
                )}
                {nonHhSubtotal > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>その他</span>
                    <span>¥{nonHhSubtotal.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-border pt-1 text-muted-foreground">
                  <span>小計</span>
                  <span>¥{subtotal.toLocaleString()}</span>
                </div>
              </>
            ) : (
              <div className="flex justify-between text-muted-foreground">
                <span>小計</span>
                <span>¥{subtotal.toLocaleString()}</span>
              </div>
            )}
            {discountAmount > 0 && (
              <div className="flex justify-between text-warning">
                <span>割引</span>
                <span>−¥{discountAmount.toLocaleString()}</span>
              </div>
            )}
            <div className="flex justify-between text-muted-foreground">
              <span>消費税 ({settings.taxRate}%)</span>
              <span>¥{taxAmount.toLocaleString()}</span>
            </div>
            <div className="flex justify-between border-t border-border pt-1 text-lg font-bold">
              <span>{splitMode && selectedItemIds.length > 0 ? "個別合計" : "合計"}</span>
              <span>¥{totalAmount.toLocaleString()}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Label className="whitespace-nowrap text-xs">預かり金</Label>
            <div className="flex flex-1 items-center gap-1">
              <span className="text-sm">¥</span>
              <Input
                type="number"
                value={cashReceived}
                onChange={(e) => setCashReceived(e.target.value)}
                placeholder="0"
                className="h-8"
              />
            </div>
            {cashReceivedNum > 0 && (
              <div
                className={cn(
                  "whitespace-nowrap text-sm font-bold",
                  change >= 0 ? "text-success" : "text-destructive",
                )}
              >
                釣: ¥{change.toLocaleString()}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Button
              size="lg"
              className="h-14 bg-success text-primary-foreground hover:bg-success/90"
              disabled={!session || totalAmount === 0}
              onClick={handleCheckoutCash}
            >
              <Banknote className="mr-2 h-5 w-5" />
              <div className="flex flex-col items-start">
                <span className="font-bold">現金</span>
                <span className="text-xs opacity-80">キャッシュ</span>
              </div>
            </Button>
            <Button
              size="lg"
              className="h-14 bg-info text-foreground hover:bg-info/90"
              disabled={!session || totalAmount === 0}
              onClick={handleCheckoutCashless}
            >
              <CreditCard className="mr-2 h-5 w-5" />
              <div className="flex flex-col items-start">
                <span className="font-bold">クレペイ</span>
                <span className="text-xs opacity-80">カード・QR</span>
              </div>
            </Button>
          </div>

          {selectedBlock.status === "checked_out" && (
            <Button
              size="lg"
              className="h-14 w-full bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={onBussingComplete}
            >
              <CheckCheck className="mr-2 h-5 w-5" />
              <div className="flex flex-col items-start">
                <span className="font-bold">バッシング完了</span>
                <span className="text-xs opacity-80">空席にする</span>
              </div>
            </Button>
          )}

          {(selectedBlock.status === "empty" || selectedBlock.status === "reserved") && !session && (
            <Button
              size="lg"
              variant={selectedBlock.status === "reserved" ? "destructive" : "outline"}
              className="h-14 w-full"
              onClick={() => onReserveBlock(selectedBlock.id)}
            >
              <div className="flex flex-col items-start">
                <span className="font-bold">
                  {selectedBlock.status === "reserved" ? "予約を解除" : "予約にする"}
                </span>
                <span className="text-xs opacity-80">
                  {selectedBlock.status === "reserved" ? "空席に戻す" : "席を仮押さえ"}
                </span>
              </div>
            </Button>
          )}
        </div>
      </div>

      {/* ── オーダー追加モーダル ────────────────────────────────────── */}
      {showOrderModal && (
        <div className="fixed inset-0 z-[60] flex flex-col">
          {/* 背景オーバーレイ */}
          <div className="flex-1 bg-black/60" onClick={handleCloseOrderModal} />

          {/* モーダルパネル（ボトムシート） */}
          <div
            className="flex max-h-[88vh] w-full flex-col rounded-t-2xl bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* モーダルヘッダー */}
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <ShoppingCart className="h-5 w-5 text-primary" />
              <h3 className="flex-1 text-lg font-bold">オーダー追加</h3>
              {pendingTotal > 0 && (
                <span className="rounded-full bg-primary px-3 py-0.5 text-xs font-bold text-primary-foreground">
                  {pendingTotal}点選択中
                </span>
              )}
              <Button variant="ghost" size="icon" onClick={handleCloseOrderModal}>
                <X className="h-5 w-5" />
              </Button>
            </div>

            {/* 商品グリッド */}
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {sortedCategories.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  商品マスタに商品がありません
                </p>
              ) : (
                <div className="space-y-3">
                  {sortedCategories.map((catName) => {
                    const catProducts = activeProducts
                      .filter((p) => p.category === catName)
                      .sort((a, b) => a.displayOrder - b.displayOrder)
                    if (catProducts.length === 0) return null
                    const isCatOpen = openCategoryIds.has(catName)
                    const catSelectedQty = catProducts.reduce(
                      (s, p) => s + (pendingCounts[p.id] || 0),
                      0,
                    )

                    return (
                      <div key={catName}>
                        {/* カテゴリヘッダー */}
                        <button
                          className="flex w-full items-center justify-between rounded-lg bg-muted px-3 py-2.5 text-left transition-colors hover:bg-muted/70"
                          onClick={() => toggleCategory(catName)}
                        >
                          <span className="font-semibold text-sm">{catName}</span>
                          <div className="flex items-center gap-2">
                            {catSelectedQty > 0 && (
                              <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground">
                                {catSelectedQty}点
                              </span>
                            )}
                            {isCatOpen ? (
                              <ChevronUp className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            )}
                          </div>
                        </button>

                        {/* 商品カード */}
                        {isCatOpen && (
                          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                            {catProducts.map((product) => {
                              const count = pendingCounts[product.id] || 0
                              return (
                                <button
                                  key={product.id}
                                  className={cn(
                                    "relative flex flex-col items-center justify-center rounded-xl border-2 px-2 py-4 text-center transition-all active:scale-95",
                                    count > 0
                                      ? "border-primary bg-primary/10 shadow-sm"
                                      : "border-border bg-background hover:bg-muted/60",
                                  )}
                                  onClick={() => handlePendingAdd(product.id)}
                                >
                                  {/* 選択数バッジ */}
                                  {count > 0 && (
                                    <span className="absolute -right-2.5 -top-2.5 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground shadow">
                                      {count}
                                    </span>
                                  )}
                                  <span className="text-sm font-semibold leading-tight">
                                    {product.name}
                                  </span>
                                  <span className="mt-1.5 text-xs text-muted-foreground">
                                    ¥{product.price.toLocaleString()}
                                  </span>
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* フッター: 選択中アイテム + 確定ボタン */}
            <div className="border-t border-border bg-card">
              {pendingTotal > 0 ? (
                <div className="space-y-3 p-4">
                  {/* 選択済みアイテム一覧 */}
                  <div className="max-h-36 space-y-1.5 overflow-y-auto">
                    {Object.entries(pendingCounts)
                      .filter(([, qty]) => qty > 0)
                      .map(([productId, qty]) => {
                        const product = activeProducts.find((p) => p.id === productId)
                        if (!product) return null
                        return (
                          <div
                            key={productId}
                            className="flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5"
                          >
                            <span className="flex-1 truncate text-sm font-medium">
                              {product.name}
                            </span>
                            <div className="flex shrink-0 items-center gap-1">
                              <button
                                className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background hover:bg-muted"
                                onClick={() => handlePendingAdjust(productId, -1)}
                              >
                                <Minus className="h-3 w-3" />
                              </button>
                              <span className="w-5 text-center text-sm font-bold">{qty}</span>
                              <button
                                className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background hover:bg-muted"
                                onClick={() => handlePendingAdjust(productId, 1)}
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            </div>
                            <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">
                              ¥{(product.price * qty).toLocaleString()}
                            </span>
                          </div>
                        )
                      })}
                  </div>

                  {/* 合計 */}
                  <div className="flex items-center justify-between px-1 text-sm">
                    <span className="text-muted-foreground">計 {pendingTotal}点</span>
                    <span className="font-semibold">¥{pendingSubtotal.toLocaleString()}</span>
                  </div>

                  {/* 確定ボタン */}
                  <button
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 font-bold text-base text-primary-foreground shadow-md transition-all active:scale-[0.98] hover:bg-primary/90"
                    onClick={handleConfirmOrder}
                  >
                    <Check className="h-5 w-5" />
                    {pendingTotal}点を注文に追加する
                  </button>
                </div>
              ) : (
                <div className="p-4">
                  <p className="mb-3 text-center text-sm text-muted-foreground">
                    商品をタップして選択してください
                  </p>
                  <Button variant="outline" className="w-full" onClick={handleCloseOrderModal}>
                    キャンセル
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
