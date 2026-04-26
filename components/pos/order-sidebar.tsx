"use client"

import { useState, useMemo } from "react"
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
  Timer,
  Users,
  Link2,
} from "lucide-react"

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
}: OrderSidebarProps) {
  const [showMenu, setShowMenu] = useState(false)
  const [openCategoryIds, setOpenCategoryIds] = useState<Set<string>>(new Set())
  const [splitMode, setSplitMode] = useState(false)
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])
  const [selectedCouponId, setSelectedCouponId] = useState<string>("")
  const [cashReceived, setCashReceived] = useState<string>("")
  const [guestCount, setGuestCount] = useState<number>(session?.guestCount ?? 1)
  const [editingMemoId, setEditingMemoId] = useState<string | null>(null)

  const toggleCategory = (catId: string) => {
    setOpenCategoryIds((prev) => {
      const next = new Set(prev)
      next.has(catId) ? next.delete(catId) : next.add(catId)
      return next
    })
  }

  // カテゴリ別商品リスト（products の category テキストから動的生成）
  // ※ Rules of Hooks: 条件付き return より前に全 Hook を呼ぶ必要があるためここに配置
  const activeProducts = products.filter((p) => p.isActive)
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

  const targetItems = splitMode && selectedItemIds.length > 0
    ? unpaidItems.filter((i) => selectedItemIds.includes(i.id))
    : unpaidItems

  const subtotal = targetItems.reduce((sum, i) => sum + i.subtotal, 0)

  const selectedCoupon = coupons.find((c) => c.id === selectedCouponId && c.isActive)
  const discountAmount = selectedCoupon
    ? selectedCoupon.discountType === "amount"
      ? Math.min(selectedCoupon.discountValue, subtotal)
      : Math.round(subtotal * selectedCoupon.discountValue / 100)
    : 0

  const taxBase = subtotal - discountAmount
  const taxAmount = Math.round(taxBase * settings.taxRate / 100)
  const totalAmount = taxBase + taxAmount

  const cashReceivedNum = parseInt(cashReceived, 10) || 0
  const change = cashReceivedNum - totalAmount

  const ensureSession = (): BlockSession => {
    if (session) return session
    return {
      id: `s-${Date.now()}`,
      blockId: selectedBlock.id,
      orderItems: [],
      startedAt: new Date(),
      guestCount: guestCount,
    }
  }

  const handleAddItem = (product: Product) => {
    const s = ensureSession()
    const existing = s.orderItems.find(
      (i) => i.productId === product.id && !i.isPaid && !i.optionMemo
    )
    let updatedItems: OrderItem[]
    if (existing) {
      updatedItems = s.orderItems.map((i) =>
        i.id === existing.id
          ? { ...i, quantity: i.quantity + 1, subtotal: (i.quantity + 1) * i.price }
          : i
      )
    } else {
      const newItem: OrderItem = {
        id: `i-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        productId: product.id,
        name: product.name,
        price: product.price,
        quantity: 1,
        subtotal: product.price,
        servingStatus: "unserved",
        orderedAt: new Date(),
        isPaid: false,
      }
      updatedItems = [...s.orderItems, newItem]
    }
    onUpdateSession({ ...s, orderItems: updatedItems, guestCount })
  }

  const handleQuantityChange = (itemId: string, delta: number) => {
    if (!session) return
    const updatedItems = session.orderItems
      .map((i) =>
        i.id === itemId
          ? { ...i, quantity: Math.max(0, i.quantity + delta), subtotal: Math.max(0, i.quantity + delta) * i.price }
          : i
      )
      .filter((i) => i.quantity > 0)
    onUpdateSession({ ...session, orderItems: updatedItems })
  }

  const handleToggleServed = (itemId: string) => {
    if (!session) return
    const updatedItems = session.orderItems.map((i) => {
      if (i.id !== itemId) return i
      const nowServed = i.servingStatus === "unserved"
      return {
        ...i,
        servingStatus: nowServed ? ("served" as const) : ("unserved" as const),
        servedAt: nowServed ? new Date() : undefined,
      }
    })
    onUpdateSession({ ...session, orderItems: updatedItems })
  }

  const handleUpdateMemo = (itemId: string, memo: string) => {
    if (!session) return
    const updatedItems = session.orderItems.map((i) =>
      i.id === itemId ? { ...i, optionMemo: memo } : i
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
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]
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
    setShowMenu(false)
  }

  const formatTime = (d: Date) =>
    d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })

  return (
    <div
      className={cn(
        "fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-xl transition-transform duration-300",
        isOpen ? "translate-x-0" : "translate-x-full"
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
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-5 w-5" />
        </Button>
      </div>

      {/* 連結席セクション（解除のみ） */}
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

      {/* Order Items */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold">注文内容</h3>
          <Button variant="outline" size="sm" onClick={() => setShowMenu(!showMenu)}>
            <Plus className="mr-1 h-4 w-4" />
            追加
            {showMenu ? <ChevronUp className="ml-1 h-4 w-4" /> : <ChevronDown className="ml-1 h-4 w-4" />}
          </Button>
        </div>

        {/* Menu */}
        {showMenu && (
          <Card className="mb-4">
            <CardContent className="p-0">
              {sortedCategories.map((catName) => {
                const catProducts = activeProducts
                  .filter((p) => p.category === catName)
                  .sort((a, b) => a.displayOrder - b.displayOrder)
                if (catProducts.length === 0) return null
                const isOpen = openCategoryIds.has(catName)
                return (
                  <div key={catName} className="border-b border-border last:border-0">
                    {/* カテゴリヘッダー（タップで開閉） */}
                    <button
                      className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-muted/50 transition-colors"
                      onClick={() => toggleCategory(catName)}
                    >
                      <span className="text-xs font-semibold text-muted-foreground">{catName}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-muted-foreground">{catProducts.length}品</span>
                        {isOpen
                          ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                          : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                        }
                      </div>
                    </button>
                    {/* 商品一覧（開いているときのみ表示） */}
                    {isOpen && (
                      <div className="grid grid-cols-2 gap-1.5 px-3 pb-3">
                        {catProducts.map((product) => (
                          <Button
                            key={product.id}
                            variant="secondary"
                            size="sm"
                            className="h-auto flex-col py-2"
                            onClick={() => handleAddItem(product)}
                          >
                            <span className="text-xs leading-tight">{product.name}</span>
                            <span className="text-[10px] text-muted-foreground">¥{product.price.toLocaleString()}</span>
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </CardContent>
          </Card>
        )}

        {/* Order List */}
        {unpaidItems.length > 0 ? (
          <div className="space-y-2">
            {unpaidItems.map((item) => (
              <div
                key={item.id}
                className={cn(
                  "rounded-lg border border-border p-3 transition-colors",
                  splitMode && selectedItemIds.includes(item.id) && "border-primary bg-primary/10",
                  item.servingStatus === "served" && "bg-success/10"
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
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-sm truncate">{item.name}</p>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatTime(item.orderedAt)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      ¥{item.price.toLocaleString()} × {item.quantity} = ¥{item.subtotal.toLocaleString()}
                    </p>
                    {item.servedAt && (
                      <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Timer className="h-2.5 w-2.5" />
                        提供: {formatTime(item.servedAt)}
                      </p>
                    )}

                    {/* Option memo */}
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
                        onClick={(e) => { e.stopPropagation(); setEditingMemoId(item.id) }}
                      >
                        <MessageSquare className="h-2.5 w-2.5" />
                        {item.optionMemo ? item.optionMemo : "メモ追加"}
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-2 flex items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
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
                      variant={item.servingStatus === "served" ? "default" : "secondary"}
                      size="sm"
                      className={cn(
                        "h-7 w-20 text-xs",
                        item.servingStatus === "served" && "bg-success text-primary-foreground"
                      )}
                      onClick={() => handleToggleServed(item.id)}
                    >
                      {item.servingStatus === "served" ? (
                        <><Check className="mr-1 h-3 w-3" />提供済</>
                      ) : (
                        <><Clock className="mr-1 h-3 w-3" />未提供</>
                      )}
                    </Button>
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
            <p className="text-muted-foreground text-sm">注文がありません</p>
          </div>
        )}
      </div>

      {/* Checkout Area */}
      <div className="border-t border-border p-4 space-y-3">
        {/* Split mode & coupon */}
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
            {coupons.filter((c) => c.isActive).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* 金額内訳 */}
        <div className="space-y-1 rounded-lg bg-muted p-3 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>小計</span>
            <span>¥{subtotal.toLocaleString()}</span>
          </div>
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

        {/* 預かり金 */}
        <div className="flex items-center gap-2">
          <Label className="text-xs whitespace-nowrap">預かり金</Label>
          <div className="flex-1 flex items-center gap-1">
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
            <div className={cn(
              "text-sm font-bold whitespace-nowrap",
              change >= 0 ? "text-success" : "text-destructive"
            )}>
              釣: ¥{change.toLocaleString()}
            </div>
          )}
        </div>

        {/* Payment buttons */}
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
      </div>
    </div>
  )
}
