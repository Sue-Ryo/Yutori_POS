"use client"

import { useState, useMemo, useEffect, useRef } from "react"
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
import { Input, inputVariants } from "@/components/ui/input"
import { ImeInput, isComposingEvent } from "@/components/ui/ime-input"
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
  Loader2,
  AlertCircle,
  RotateCcw,
  Sparkles,
} from "lucide-react"

import {
  HAPPY_HOUR_BASE,
  DRINK_CAP_PER_PERSON,
  NIGHT_CHARGE_NAME,
  isHhTarget as hhIsTarget,
  calcHhSubtotal,
  resolveCategory,
  splitRoundGuestCount,
} from "@/lib/hh-calc"

import {
  SQUARE_APP_ID,
  startSquarePosPayment,
  type SquareTender,
  type SquarePhase,
} from "@/lib/square-pos-link"
import { loadSplitPlan, saveSplitPlan, clearSplitPlan } from "@/lib/split-checkout"

/** 1品無料クーポンの減額上限。これを超える商品は上限まで、下回る商品は商品金額まで引く */
const FREE_DRINK_MAX_DISCOUNT = 900

// 明細を数量単位で選ぶリスト。個別会計と連結解除の両方で使う
function OrderItemSelectList({
  items,
  quantities,
  locked = false,
  qtyLabel,
  happyHour,
  isHhTarget,
  onToggle,
  onQtyChange,
}: {
  items: OrderItem[]
  /** 明細ID → 選択数量。未設定・0 は未選択 */
  quantities: Record<string, number>
  /** true なら選択を変更できない（最終回など） */
  locked?: boolean
  qtyLabel: string
  happyHour: boolean
  isHhTarget: (item: OrderItem) => boolean
  onToggle: (item: OrderItem) => void
  onQtyChange: (item: OrderItem, delta: number) => void
}) {
  return (
    <div className="space-y-2">
      {items.map((item) => {
        const qty = quantities[item.id] ?? 0
        const checked = qty > 0
        const isPartial = checked && qty < item.quantity
        return (
          <div
            key={item.id}
            className={cn(
              "rounded-lg border transition-colors",
              checked ? "border-primary bg-primary/10" : "border-border",
            )}
          >
            <button
              disabled={locked}
              onClick={() => onToggle(item)}
              className={cn(
                "flex w-full items-center gap-3 p-3 text-left",
                locked ? "cursor-default" : "active:scale-[0.99]",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded border-2",
                  checked ? "border-primary bg-primary" : "border-muted-foreground/40",
                )}
              >
                {checked && <Check className="h-3.5 w-3.5 text-primary-foreground" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-medium text-sm">{item.name}</span>
                  {happyHour && isHhTarget(item) && (
                    <span className="shrink-0 rounded bg-orange-500 px-1 py-0.5 text-[10px] font-bold text-white">HH</span>
                  )}
                </span>
                <span className="block text-xs text-muted-foreground">
                  ¥{item.price.toLocaleString()} × {item.quantity}
                  {item.optionMemo ? ` / ${item.optionMemo}` : ""}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-sm font-semibold">
                  ¥{(item.price * (checked ? qty : item.quantity)).toLocaleString()}
                </span>
                {isPartial && (
                  <span className="block text-[10px] text-muted-foreground">{qty}点ぶん</span>
                )}
              </span>
            </button>

            {/* 同じ商品が複数ある明細は、含める数を選べるようにする */}
            {item.quantity > 1 && !locked && (
              <div className="flex items-center justify-between gap-2 border-t border-border/60 px-3 py-2">
                <span className="text-xs text-muted-foreground">{qtyLabel}</span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    disabled={qty <= 0}
                    onClick={() => onQtyChange(item, -1)}
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                  <span className="w-10 text-center text-sm font-bold tabular-nums">
                    {qty} / {item.quantity}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    disabled={qty >= item.quantity}
                    onClick={() => onQtyChange(item, 1)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

interface OrderSidebarProps {
  isOpen: boolean
  onClose: () => void
  storeId: number
  selectedBlock: ServiceBlock | null
  session: BlockSession | null
  products: Product[]
  coupons: Coupon[]
  settings: BusinessSettings
  blocks: ServiceBlock[]
  onUpdateSession: (session: BlockSession) => void
  onCheckout: (sessionId: string, data: CheckoutData) => void
  onUnlinkBlock: (sessionId: string, blockIdToUnlink: string, itemQuantities: Record<string, number>) => void
  onBussingComplete: () => void
  onReserveBlock: (blockId: string) => void
  happyHour: boolean
  onHappyHourChange: (value: boolean) => void
  customerName: string
  onCustomerNameChange: (name: string) => void
  isNewCustomer: boolean
  onIsNewCustomerChange: (value: boolean) => void
  /** 分割会計の1回分が終わって次の回へ進むときの合図。nonce は回ごとに増える */
  resumeSplit: { sessionId: string; nonce: number } | null
  onResumeSplitHandled: () => void
}

export function OrderSidebar({
  isOpen,
  onClose,
  storeId,
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
  happyHour,
  onHappyHourChange,
  customerName,
  onCustomerNameChange,
  isNewCustomer,
  onIsNewCustomerChange,
  resumeSplit,
  onResumeSplitHandled,
}: OrderSidebarProps) {
  const [showOrderModal, setShowOrderModal] = useState(false)
  const [pendingCounts, setPendingCounts] = useState<Record<string, number>>({})
  const [openCategoryIds, setOpenCategoryIds] = useState<Set<string>>(new Set())
  const [splitMode, setSplitMode] = useState(false)
  // 個別会計でこの回に含める数量（明細ID → 数量）。同じ商品がまとまった明細を
  // 数量単位で分けられるよう、ID の集合ではなく数量で持つ
  const [roundQty, setRoundQty] = useState<Record<string, number>>({})
  // 会計エリアは既定で畳み、オーダー内容の表示領域を優先する
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [showSplitModal, setShowSplitModal] = useState(false)
  // 連結解除でオーダーを分けるモーダル。解除する席IDと、その席へ移す数量
  const [unlinkTargetId, setUnlinkTargetId] = useState<string | null>(null)
  const [unlinkQty, setUnlinkQty] = useState<Record<string, number>>({})
  // 何回に分けて支払うか。null は回数未選択（モーダルの1画面目）
  const [splitRounds, setSplitRounds] = useState<number | null>(null)
  // 0 始まり。表示は splitRoundIndex + 1 回目
  const [splitRoundIndex, setSplitRoundIndex] = useState(0)
  const [selectedCouponId, setSelectedCouponId] = useState<string>("")
  const [showCashlessModal, setShowCashlessModal] = useState(false)
  const [showPayPayQr, setShowPayPayQr] = useState(false)
  const [cashReceived, setCashReceived] = useState<string>("")
  const [combinedMode, setCombinedMode] = useState(false)
  const [combinedCash, setCombinedCash] = useState<string>("")
  const [combinedCashless, setCombinedCashless] = useState<string>("")
  const guestCount = 1 + (session?.linkedBlockIds?.length ?? 0)
  const [editingMemoId, setEditingMemoId] = useState<string | null>(null)
  const [showNightChargeWarning, setShowNightChargeWarning] = useState(false)
  const [noteText, setNoteText] = useState<string>(session?.note ?? "")
  const [editingMemoText, setEditingMemoText] = useState<string>("")
  const [squareState, setSquareState] = useState<"idle" | "processing" | "error">("idle")
  const [squareCheckoutId, setSquareCheckoutId] = useState<string | null>(null)
  const [squareError, setSquareError] = useState<string | null>(null)
  const squarePollActiveRef = useRef(false)

  // 席またはセッションが切り替わったら備考を貼り直す
  // （selectedBlock を含めないと、セッション未作成の席同士で備考が混ざる）
  useEffect(() => {
    setNoteText(session?.note ?? "")
    setCheckoutOpen(false)
  }, [session?.id, selectedBlock?.id])

  // サイドバーが閉じたらモーダルも閉じる
  useEffect(() => {
    if (!isOpen) {
      setShowOrderModal(false)
      setPendingCounts({})
      setShowSplitModal(false)
      setUnlinkTargetId(null)
    }
  }, [isOpen])

  // 分割の初期選択。各明細の数量を回数で均等に分け、端数は先の回が多く持つ。
  // 「3人が同じものを頼んで3分割」のような使い方で、開いた時点で正しい状態にする
  const buildRoundQty = (items: OrderItem[], rounds: number, roundIndex: number) => {
    const next: Record<string, number> = {}
    items.forEach((i) => {
      const perRound = Math.floor(i.quantity / rounds)
      const remainder = i.quantity % rounds
      const qty = perRound + (roundIndex < remainder ? 1 : 0)
      if (qty > 0) next[i.id] = qty
    })
    return next
  }

  const resetSplitState = () => {
    setSplitMode(false)
    setSplitRounds(null)
    setSplitRoundIndex(0)
    setRoundQty({})
  }

  // 分割会計の進捗を localStorage から復元する。
  // Square アプリ切替で1回ごとにページが再読込されるため、state だけでは続きを追えない。
  const restoreSplitPlan = (openModal: boolean) => {
    const plan = session ? loadSplitPlan(storeId) : null
    // 別の伝票を開いたときに前の席の分割状態を持ち越さない
    if (!session || !plan || plan.sessionId !== session.id) {
      resetSplitState()
      return
    }
    // 全部払い終わっていれば分割は完了しているので進捗を捨てる
    if (session.orderItems.every((i) => i.isPaid)) {
      clearSplitPlan(storeId)
      resetSplitState()
      return
    }
    setSplitMode(true)
    setSplitRounds(plan.totalRounds)
    setSplitRoundIndex(plan.completedRounds)
    // 最終回は splitQtyById 側で残り全てに導出されるため、ここでの初期値は使われない
    setRoundQty(
      buildRoundQty(
        session.orderItems.filter((i) => !i.isPaid),
        plan.totalRounds,
        plan.completedRounds,
      ),
    )
    if (openModal) setShowSplitModal(true)
  }

  // 分割途中の席を開き直したとき：進捗だけ戻し、モーダルは開かない
  useEffect(() => {
    if (isOpen) restoreSplitPlan(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, session?.id])

  // 1回分の決済が終わって戻ってきたとき：次の回のモーダルを自動で開く
  useEffect(() => {
    if (!isOpen || !session || resumeSplit?.sessionId !== session.id) return
    restoreSplitPlan(true)
    onResumeSplitHandled()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, session?.id, resumeSplit?.nonce])

  // サイドバーが閉じたら Square 処理もキャンセル
  useEffect(() => {
    if (!isOpen && squareState === "processing" && squareCheckoutId) {
      squarePollActiveRef.current = false
      fetch(`/api/square/checkout/${squareCheckoutId}`, { method: "DELETE" }).catch(() => {})
      setSquareState("idle")
      setSquareCheckoutId(null)
      setSquareError(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // 最終回は残りを全部含めないと未払いが残るため、選択状態によらず残り全てを対象にする。
  // 途中でオーダーが追加された場合も取りこぼさないよう、保存値ではなく都度導出する。
  const isFinalSplitRound = splitRounds !== null && splitRoundIndex >= splitRounds - 1
  // この回に含める数量。明細の数量を超えないよう毎回丸める
  const splitQtyById: Record<string, number> = {}
  if (splitMode) {
    unpaidItems.forEach((i) => {
      const qty = isFinalSplitRound ? i.quantity : Math.min(roundQty[i.id] ?? 0, i.quantity)
      if (qty > 0) splitQtyById[i.id] = qty
    })
  }
  const splitSelectedIds = Object.keys(splitQtyById)
  const splitSelectedUnits = Object.values(splitQtyById).reduce((sum, q) => sum + q, 0)
  const splitRemainingUnits = unpaidItems.reduce(
    (sum, i) => sum + (i.quantity - (splitQtyById[i.id] ?? 0)),
    0,
  )
  const splitRemainingSubtotal = unpaidItems.reduce(
    (sum, i) => sum + i.price * (i.quantity - (splitQtyById[i.id] ?? 0)),
    0,
  )

  // 分割会計中は選んだぶんだけが対象。一部数量だけの明細はその数量で計算する。
  // 未選択のときに全件へフォールバックすると、選ぶ前に全体の合計が出てしまうため分岐しない
  const targetItems = splitMode
    ? unpaidItems.flatMap((i) => {
        const qty = splitQtyById[i.id] ?? 0
        if (qty <= 0) return []
        return [qty >= i.quantity ? i : { ...i, quantity: qty, subtotal: i.price * qty }]
      })
    : unpaidItems

  // ハッピーアワー計算（item.category を優先、なければ productCategoryMap にフォールバック）
  const isHhTarget = (i: { name: string; productId: string; category?: string }) =>
    hhIsTarget(i, productCategoryMap)
  const hasNightCharge = unpaidItems.some((i) => i.name === NIGHT_CHARGE_NAME)
  // 分割会計では、その回が受け持つ人数ぶんだけHHを計算する。
  // 全回を足すと一括会計と同じ金額になるよう、端数は先の回から1名ずつ多く持たせ、
  // 残り全部を精算する回でまだ計上していない人数をまとめて引き受ける。
  const hhGuestCount =
    splitMode && splitRounds !== null
      ? splitRoundGuestCount(guestCount, splitRounds, splitRoundIndex, splitRemainingUnits === 0)
      : guestCount

  const hhResult = calcHhSubtotal(targetItems, hhGuestCount, productCategoryMap)
  const { happyHourCharge, drinkOverage, nonHhSubtotal } = hhResult

  // 対象が1件も無いときは0。HHは明細が空でも基本料金を返すため明示的に落とす
  const subtotal =
    targetItems.length === 0
      ? 0
      : happyHour
      ? hhResult.subtotal
      : targetItems.reduce((sum, i) => sum + i.subtotal, 0)

  const selectedCoupon = coupons.find((c) => c.id === selectedCouponId && c.isActive)
  const getItemCategory = (item: OrderItem) => item.category ?? productCategoryMap[item.productId]
  const freeDrinkItem = (() => {
    if (selectedCoupon?.discountType !== "free_drink") return null
    const drinkItems = unpaidItems.filter((i) => ["alcohol", "softdrink"].includes(getItemCategory(i) ?? ""))
    if (drinkItems.length === 0) return null
    // 最高額のドリンクを1つ対象にする。上限超過分は FREE_DRINK_MAX_DISCOUNT で頭打ち
    return drinkItems.reduce((max, i) => (i.price > max.price ? i : max))
  })()
  // 例: 1200円 → −900円（300円を計上）／700円 → −700円
  const freeDrinkDiscount = freeDrinkItem ? Math.min(freeDrinkItem.price, FREE_DRINK_MAX_DISCOUNT) : 0
  const discountAmount = selectedCoupon
    ? selectedCoupon.discountType === "fixed"
      ? Math.min(selectedCoupon.discountValue, subtotal)
      : selectedCoupon.discountType === "percent"
      ? Math.round((subtotal * selectedCoupon.discountValue) / 100)
      : Math.min(freeDrinkDiscount, subtotal)
    : 0

  const taxBase = subtotal - discountAmount
  const taxAmount = Math.round((taxBase * settings.taxRate) / 100)
  const rawTotal = taxBase + taxAmount
  // クーポン適用時は100円未満を切り捨て（例: 3690→3600）
  const totalAmount = selectedCoupon ? Math.floor(rawTotal / 100) * 100 : rawTotal
  const roundingDiscount = rawTotal - totalAmount
  const effectiveDiscountAmount = discountAmount + roundingDiscount

  const cashReceivedNum = parseInt(cashReceived, 10) || 0
  const change = cashReceivedNum - totalAmount

  const combinedCashNum = parseInt(combinedCash, 10) || 0
  const combinedCashlessNum = parseInt(combinedCashless, 10) || 0
  const combinedChange = combinedCashNum - (totalAmount - combinedCashlessNum)
  const combinedTotal = combinedCashNum + combinedCashlessNum
  const combinedValid = combinedTotal === totalAmount && combinedCashNum > 0 && combinedCashlessNum > 0

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
      customerName: customerName || undefined,
      happyHour: happyHour || undefined,
      isNewCustomer: isNewCustomer || undefined,
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

  // 備考: ローカルに保持しつつ、セッションがあれば保存する。
  // セッション未作成でも入力は保持され、初回オーダー時に ensureSession が拾う。
  const handleNoteChange = (next: string) => {
    setNoteText(next)
    if (session) onUpdateSession({ ...session, note: next || undefined })
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

  // ── 個別会計（分割会計） ──────────────────────────────────────────
  // 明細まるごとの選択切り替え（数量1の品と、まとめて選びたいとき用）
  const handleSplitToggle = (item: OrderItem) => {
    setRoundQty((prev) => {
      const next = { ...prev }
      if ((next[item.id] ?? 0) > 0) delete next[item.id]
      else next[item.id] = item.quantity
      return next
    })
  }

  // 同じ商品がまとまった明細のうち、この回に含める数だけを増減する
  const handleSplitQtyChange = (item: OrderItem, delta: number) => {
    setRoundQty((prev) => {
      const current = Math.min(prev[item.id] ?? 0, item.quantity)
      const nextQty = Math.max(0, Math.min(item.quantity, current + delta))
      const next = { ...prev }
      if (nextQty === 0) delete next[item.id]
      else next[item.id] = nextQty
      return next
    })
  }

  const handleOpenSplitModal = () => {
    // 進行中の分割があればその回から、無ければ回数選択から始める
    if (splitMode && splitRounds !== null) {
      setShowSplitModal(true)
      return
    }
    setSplitMode(true)
    setSplitRounds(null)
    setSplitRoundIndex(0)
    setRoundQty({})
    setShowSplitModal(true)
  }

  const handleSelectSplitRounds = (rounds: number) => {
    setSplitRounds(rounds)
    setSplitRoundIndex(0)
    setRoundQty(buildRoundQty(unpaidItems, rounds, 0))
  }

  // 1回目の決済前ならモーダルを閉じるだけで分割自体を取り消す
  const handleCloseSplitModal = () => {
    setShowSplitModal(false)
    if (splitRoundIndex === 0) handleAbortSplit()
  }

  const handleAbortSplit = () => {
    clearSplitPlan(storeId)
    resetSplitState()
    setShowSplitModal(false)
  }

  // ── 連結解除（オーダーの分け方を選ぶ） ───────────────────────────
  // 初期値は連結時の出所（originBlockId）。そのまま確定すれば従来どおりの分かれ方になる
  const handleOpenUnlinkModal = (blockIdToUnlink: string) => {
    const defaults: Record<string, number> = {}
    unpaidItems.forEach((i) => {
      if (i.originBlockId === blockIdToUnlink) defaults[i.id] = i.quantity
    })
    setUnlinkQty(defaults)
    setUnlinkTargetId(blockIdToUnlink)
  }

  const handleUnlinkToggle = (item: OrderItem) => {
    setUnlinkQty((prev) => {
      const next = { ...prev }
      if ((next[item.id] ?? 0) > 0) delete next[item.id]
      else next[item.id] = item.quantity
      return next
    })
  }

  const handleUnlinkQtyChange = (item: OrderItem, delta: number) => {
    setUnlinkQty((prev) => {
      const current = Math.min(prev[item.id] ?? 0, item.quantity)
      const nextQty = Math.max(0, Math.min(item.quantity, current + delta))
      const next = { ...prev }
      if (nextQty === 0) delete next[item.id]
      else next[item.id] = nextQty
      return next
    })
  }

  const handleConfirmUnlink = () => {
    if (!session || !unlinkTargetId) return
    onUnlinkBlock(session.id, unlinkTargetId, unlinkQty)
    setUnlinkTargetId(null)
    setUnlinkQty({})
  }

  // 決済前に進捗を保存する。Square から戻ったとき pos-system 側が回数を進める
  const persistSplitPlan = () => {
    if (!session || !splitMode || splitRounds === null) return
    saveSplitPlan(storeId, {
      sessionId: session.id,
      blockId: selectedBlock.id,
      totalRounds: splitRounds,
      completedRounds: splitRoundIndex,
    })
  }

  const resolvedCustomerName = customerName.trim() || undefined

  const buildCheckoutData = (cashAmount: number, cashlessAmount: number): CheckoutData => ({
    cashAmount,
    cashlessAmount,
    discountAmount: effectiveDiscountAmount,
    taxAmount,
    totalAmount,
    couponId: selectedCouponId || undefined,
    guestCount,
    paidItemIds: splitMode && splitSelectedIds.length > 0 ? splitSelectedIds : [],
    // 一部数量だけ支払う明細は、会計時に pos-system 側で支払い分と残り分に分割される
    paidItemQuantities: splitMode && splitSelectedIds.length > 0 ? splitQtyById : undefined,
    customerName: resolvedCustomerName,
    isNewCustomer,
  })

  // Squareアプリへ切り替えて決済する。結果はコールバックURL経由で pos-system 側が
  // 受け取り会計を記録するため、ここでは onCheckout を呼ばない。
  // amount は複合会計で合計と異なるため個別に渡す
  const launchSquarePos = (
    tender: SquareTender,
    data: CheckoutData,
    amount: number = data.totalAmount,
    phase?: SquarePhase,
  ): void => {
    if (!session) return
    setSquareState("processing")
    setSquareError(null)

    const launched = startSquarePosPayment(
      storeId,
      { sessionId: session.id, data, phase },
      amount,
      tender,
    )
    if (!launched) {
      setSquareState("error")
      setSquareError("この端末ではSquareアプリを起動できません。Squareアプリの入ったスマホ/タブレットでPOSを開いて会計してください")
    }
  }

  const handleCheckoutCash = () => {
    if (!session) return
    persistSplitPlan()
    const data = buildCheckoutData(totalAmount, 0)

    if (SQUARE_APP_ID) {
      launchSquarePos("cash", data)
      return
    }

    onCheckout(session.id, data)
    resetCheckoutState()
  }

  const handleCheckoutCashless = async () => {
    if (!session) return
    persistSplitPlan()

    // Square POSアプリ連携モード: 同一端末のSquareアプリへ切り替えて決済する
    if (SQUARE_APP_ID) {
      launchSquarePos("card", buildCheckoutData(0, totalAmount))
      return
    }

    setSquareState("processing")
    setSquareError(null)

    try {
      const createRes = await fetch("/api/square/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountMoney: totalAmount, referenceId: session.id, storeId }),
      })
      const createData = await createRes.json() as { checkoutId?: string; error?: string }
      if (!createRes.ok || !createData.checkoutId) throw new Error(createData.error ?? "Square エラー")

      const checkoutId = createData.checkoutId
      setSquareCheckoutId(checkoutId)
      squarePollActiveRef.current = true

      const checkoutData = buildCheckoutData(0, totalAmount)

      const poll = async () => {
        if (!squarePollActiveRef.current) return
        try {
          const pollRes = await fetch(`/api/square/checkout/${checkoutId}`)
          const pollData = await pollRes.json() as { status?: string; paymentId?: string; error?: string }

          if (pollData.status === "COMPLETED") {
            squarePollActiveRef.current = false
            onCheckout(session.id, { ...checkoutData, squarePaymentId: pollData.paymentId ?? undefined })
            resetCheckoutState()
            setSquareState("idle")
            setSquareCheckoutId(null)
          } else if (pollData.status === "CANCELED" || pollData.status === "CANCEL_REQUESTED") {
            squarePollActiveRef.current = false
            setSquareState("idle")
            setSquareCheckoutId(null)
          } else if (pollData.status === "DECLINED" || pollData.error) {
            squarePollActiveRef.current = false
            setSquareState("error")
            setSquareError(pollData.error ?? "決済が拒否されました")
            setSquareCheckoutId(null)
          } else {
            setTimeout(poll, 2000)
          }
        } catch {
          if (squarePollActiveRef.current) {
            setTimeout(poll, 2000)
          }
        }
      }

      setTimeout(poll, 2000)
    } catch (err) {
      setSquareState("error")
      setSquareError(err instanceof Error ? err.message : "エラーが発生しました")
    }
  }

  // PayPayは店頭QRでの受け取りのためSquareを経由せず、POSに直接記録する
  const handleCheckoutPayPay = () => {
    if (!session) return
    persistSplitPlan()
    onCheckout(session.id, buildCheckoutData(0, totalAmount))
    setShowCashlessModal(false)
    resetCheckoutState()
  }

  const handleCancelSquare = async () => {
    squarePollActiveRef.current = false
    if (squareCheckoutId) {
      await fetch(`/api/square/checkout/${squareCheckoutId}`, { method: "DELETE" }).catch(() => {})
    }
    setSquareState("idle")
    setSquareCheckoutId(null)
    setSquareError(null)
  }

  const handleCheckoutCombined = () => {
    if (!session || !combinedValid) return
    persistSplitPlan()
    const data = buildCheckoutData(combinedCashNum, combinedCashlessNum)

    // Squareアプリは1回の起動で分割できないため、まず現金分だけを決済する。
    // 復帰後にクレペイ分の決済が pos-system 側から続けて起動される
    if (SQUARE_APP_ID) {
      launchSquarePos("cash", data, combinedCashNum, "cash")
      return
    }

    onCheckout(session.id, data)
    resetCheckoutState()
  }

  const resetCheckoutState = () => {
    setSplitMode(false)
    setRoundQty({})
    setSplitRounds(null)
    setSplitRoundIndex(0)
    setShowSplitModal(false)
    setSelectedCouponId("")
    setCashReceived("")
    setCombinedMode(false)
    setCombinedCash("")
    setCombinedCashless("")
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
        <div className="flex items-center justify-between border-b border-border p-3 sm:p-4">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold shrink-0">{selectedBlock.name}</h2>
              <ImeInput
                value={customerName}
                onValueChange={onCustomerNameChange}
                enterKeyHint="done"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !isComposingEvent(e)) e.currentTarget.blur()
                }}
                placeholder="顧客名"
                className="min-w-0 flex-1 bg-transparent text-base text-foreground placeholder:text-muted-foreground/40 outline-none border-b border-border/50 focus:border-primary"
              />
            </div>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              {/* 空席の席に前の客の入店時間が残って見えないようにする */}
              {session && selectedBlock.status !== "empty" && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatTime(session.startedAt)}〜
                </span>
              )}
              <div className="flex items-center gap-1">
                <Users className="h-3 w-3" />
                <span className="text-sm font-medium">{guestCount}</span>
                <span>名</span>
                {(session?.linkedBlockIds?.length ?? 0) > 0 && (
                  <span className="rounded bg-info/15 px-1 py-0.5 text-[10px] font-medium text-info">連結</span>
                )}
              </div>
              {/* 新規客の目印。オーダー入力中も常に見える位置に置く */}
              <button
                onClick={() => onIsNewCustomerChange(!isNewCustomer)}
                className={cn(
                  "flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold transition-colors",
                  isNewCustomer
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:border-primary/60 hover:text-foreground",
                )}
              >
                <Sparkles className="h-3 w-3" />
                新規
              </button>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <FileText className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
              <ImeInput
                value={noteText}
                onValueChange={handleNoteChange}
                enterKeyHint="done"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !isComposingEvent(e)) e.currentTarget.blur()
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
                      onClick={() => handleOpenUnlinkModal(linkedId)}
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
        <div className="flex-1 overflow-y-auto p-3 sm:p-4">
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
                    splitMode && splitSelectedIds.includes(item.id) && "border-primary bg-primary/10",
                  )}
                >
                  <div className="flex items-start gap-2">
                    {/* 選択自体は個別会計モーダルで行う。ここはこの回の対象を示すだけ。
                        一部の数量だけ対象のときはその数を添える */}
                    {splitMode && (splitQtyById[item.id] ?? 0) > 0 && (
                      <span className="mt-0.5 flex shrink-0 items-center gap-0.5 text-primary">
                        <Check className="h-4 w-4" />
                        {splitQtyById[item.id] < item.quantity && (
                          <span className="text-[10px] font-bold">{splitQtyById[item.id]}点</span>
                        )}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <p className="truncate font-medium text-sm">{item.name}</p>
                          {happyHour && isHhTarget(item) && (
                            <span className="shrink-0 rounded bg-orange-500 px-1 py-0.5 text-[10px] font-bold text-white">HH</span>
                          )}
                        </div>
                        <span className="whitespace-nowrap text-xs text-muted-foreground">
                          {formatTime(item.orderedAt)}
                        </span>
                      </div>
                      {happyHour && isHhTarget(item) ? (
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
                          <ImeInput
                            autoFocus
                            value={editingMemoText}
                            onValueChange={setEditingMemoText}
                            commitDelay={0}
                            placeholder="例: 氷少なめ"
                            enterKeyHint="done"
                            className={cn(...inputVariants, "h-7 text-xs")}
                            onBlur={(e) => {
                              handleUpdateMemo(item.id, e.currentTarget.value)
                              setEditingMemoId(null)
                            }}
                            onKeyDown={(e) => {
                              // 変換確定の Enter で編集を閉じない
                              if (e.key === "Enter" && !isComposingEvent(e)) {
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
                            setEditingMemoText(item.optionMemo ?? "")
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
        <div className="space-y-3 border-t border-border p-3 sm:p-4">
          {/* 分割会計の進行状況。モーダルを閉じても続きが分かるようにする */}
          {splitMode && splitRounds !== null && (
            <div className="rounded-lg border border-info bg-info/10 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-info">
                  <Split className="h-4 w-4 shrink-0" />
                  <span className="text-sm font-bold">
                    個別会計 {splitRoundIndex + 1}回目 / 全{splitRounds}回
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {splitSelectedUnits}点選択
                </span>
              </div>
              <div className="mt-2 flex gap-2">
                <Button size="sm" className="h-8 flex-1" onClick={() => setShowSplitModal(true)}>
                  この回の会計を続ける
                </Button>
                <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={handleAbortSplit}>
                  分割をやめる
                </Button>
              </div>
            </div>
          )}

          {/* Square の進行状況は畳んでいても見えるようにセクションの外に置く */}
          {squareState === "processing" && (
            <div className="rounded-lg border border-info bg-info/10 p-4 space-y-3">
              <div className="flex items-center gap-2 text-info">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="font-bold">Square 決済処理中</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {SQUARE_APP_ID ? "Squareアプリを起動しています…" : "端末でカードをタッチ・挿入してください"}
              </p>
              <p className="text-lg font-bold">¥{totalAmount.toLocaleString()}</p>
              <Button variant="outline" className="w-full" onClick={handleCancelSquare}>
                キャンセル
              </Button>
            </div>
          )}

          {squareState === "error" && (
            <div className="rounded-lg border border-destructive bg-destructive/10 p-3 space-y-2">
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-4 w-4" />
                <span className="text-sm font-bold">Square 決済エラー</span>
              </div>
              <p className="text-xs text-destructive">{squareError}</p>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => { setSquareState("idle"); setSquareError(null) }}
              >
                閉じる
              </Button>
            </div>
          )}

          {/* 会計セクション（畳んでオーダー内容の表示領域を広く取る） */}
          <button
            onClick={() => setCheckoutOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2.5 text-left transition-colors hover:bg-muted"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="font-bold">会計</span>
              {/* 畳んだときに隠れると困る情報はここに出す */}
              {happyHour && (
                <span className="shrink-0 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">HH</span>
              )}
              {selectedCoupon && (
                <span className="truncate rounded bg-warning/20 px-1.5 py-0.5 text-[10px] font-bold text-warning">
                  {selectedCoupon.name}
                </span>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <span className="font-bold">
                {checkoutOpen
                  ? `¥${totalAmount.toLocaleString()}`
                  : `合計金額（¥${totalAmount.toLocaleString()}）`}
              </span>
              {checkoutOpen ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              )}
            </span>
          </button>

          {checkoutOpen && (<>
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
            onClick={() => {
              if (!happyHour && hasNightCharge) {
                setShowNightChargeWarning(true)
                return
              }
              onHappyHourChange(!happyHour)
            }}
          >
            <Zap className={cn("mr-1.5 h-4 w-4", happyHour && "fill-white")} />
            {happyHour ? `ハッピーアワー適用中 (¥${HAPPY_HOUR_BASE.toLocaleString()}/人)` : "ハッピーアワー"}
          </Button>

          <div className="flex flex-col gap-1">
            <select
              className="w-full rounded-md border border-border bg-background px-2 text-sm h-9"
              value={selectedCouponId}
              onChange={(e) => setSelectedCouponId(e.target.value)}
            >
              <option value="">クーポンなし</option>
              {coupons
                .filter((c) => c.isActive)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}（
                    {c.discountType === "fixed"
                      ? `−¥${c.discountValue.toLocaleString()}`
                      : c.discountType === "percent"
                      ? `−${c.discountValue}%`
                      : "1品無料"}
                    ）
                  </option>
                ))}
            </select>
            {selectedCoupon?.discountType === "free_drink" && (
              <span className="text-xs">
                {freeDrinkItem ? (
                  <span className="text-warning font-medium">
                    無料: {freeDrinkItem.name} (−¥{freeDrinkDiscount.toLocaleString()}
                    {freeDrinkItem.price > FREE_DRINK_MAX_DISCOUNT
                      ? ` / ¥${FREE_DRINK_MAX_DISCOUNT.toLocaleString()}上限`
                      : ""}
                    )
                  </span>
                ) : (
                  <span className="text-muted-foreground">ドリンクの注文がありません</span>
                )}
              </span>
            )}
          </div>

          <div className="space-y-1 rounded-lg bg-muted p-3 text-sm">
            {happyHour ? (
              <>
                <div className="flex justify-between text-amber-600 dark:text-amber-400">
                  <span>HH基本 (¥{HAPPY_HOUR_BASE.toLocaleString()} × {hhGuestCount}名)</span>
                  <span>¥{(HAPPY_HOUR_BASE * hhGuestCount).toLocaleString()}</span>
                </div>
                {drinkOverage > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>ドリンク超過 (¥{DRINK_CAP_PER_PERSON}/人上限超え)</span>
                    <span>¥{drinkOverage.toLocaleString()}</span>
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
              <span>{splitMode && splitSelectedIds.length > 0 ? "個別合計" : "合計"}</span>
              <span>¥{totalAmount.toLocaleString()}</span>
            </div>
          </div>

          {squareState === "idle" && (!combinedMode ? (
            <>
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
                    <span className="text-xs opacity-80">
                      {SQUARE_APP_ID ? "Squareアプリで処理" : "キャッシュ"}
                    </span>
                  </div>
                </Button>
                <Button
                  size="lg"
                  className="h-14 bg-info text-foreground hover:bg-info/90"
                  disabled={!session || totalAmount === 0}
                  onClick={() => setShowCashlessModal(true)}
                >
                  <CreditCard className="mr-2 h-5 w-5" />
                  <div className="flex flex-col items-start">
                    <span className="font-bold">クレペイ</span>
                    <span className="text-xs opacity-80">カード・QR</span>
                  </div>
                </Button>
              </div>

              <Button
                size="lg"
                variant="outline"
                className="h-12 w-full"
                disabled={!session || totalAmount === 0}
                onClick={() => setCombinedMode(true)}
              >
                <Banknote className="mr-1.5 h-4 w-4" />
                <CreditCard className="mr-2 h-4 w-4" />
                <div className="flex flex-col items-start">
                  <span className="font-bold text-sm">複合会計（現金＋クレペイ）</span>
                </div>
              </Button>

              <Button
                size="lg"
                variant="outline"
                className="h-12 w-full"
                // 分割開始には最低2点必要。進行中は残り1点でも続きを開けるようにする
                disabled={!splitMode && totalOrderedQty < 2}
                onClick={handleOpenSplitModal}
              >
                <Split className="mr-2 h-4 w-4" />
                <div className="flex flex-col items-start">
                  <span className="font-bold text-sm">
                    {splitMode && splitRounds !== null
                      ? `個別会計（${splitRoundIndex + 1}/${splitRounds}回目）`
                      : "個別会計（オーダーを分けて支払う）"}
                  </span>
                </div>
              </Button>
            </>
          ) : (
            <>
              <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold">複合会計</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => { setCombinedMode(false); setCombinedCash(""); setCombinedCashless("") }}
                  >
                    キャンセル
                  </Button>
                </div>

                <div className="flex items-center gap-2">
                  <Banknote className="h-4 w-4 text-success shrink-0" />
                  <Label className="whitespace-nowrap text-xs w-14">現金</Label>
                  <div className="flex flex-1 items-center gap-1">
                    <span className="text-sm">¥</span>
                    <Input
                      type="number"
                      value={combinedCash}
                      onChange={(e) => setCombinedCash(e.target.value)}
                      placeholder="0"
                      className="h-8"
                    />
                  </div>
                  {combinedCashNum > 0 && (
                    <div className={cn("whitespace-nowrap text-xs font-bold", combinedChange >= 0 ? "text-success" : "text-destructive")}>
                      釣: ¥{combinedChange.toLocaleString()}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-info shrink-0" />
                  <Label className="whitespace-nowrap text-xs w-14">クレペイ</Label>
                  <div className="flex flex-1 items-center gap-1">
                    <span className="text-sm">¥</span>
                    <Input
                      type="number"
                      value={combinedCashless}
                      onChange={(e) => setCombinedCashless(e.target.value)}
                      placeholder="0"
                      className="h-8"
                    />
                  </div>
                </div>

                <div className={cn(
                  "flex justify-between text-xs font-medium pt-1 border-t border-border",
                  combinedTotal === totalAmount ? "text-success" : combinedTotal > 0 ? "text-destructive" : "text-muted-foreground"
                )}>
                  <span>合計入力</span>
                  <span>¥{combinedTotal.toLocaleString()} / ¥{totalAmount.toLocaleString()}</span>
                </div>
              </div>

              <Button
                size="lg"
                className="h-14 w-full bg-primary text-primary-foreground hover:bg-primary/90"
                disabled={!session || !combinedValid}
                onClick={handleCheckoutCombined}
              >
                <Banknote className="mr-1.5 h-5 w-5" />
                <CreditCard className="mr-2 h-5 w-5" />
                <div className="flex flex-col items-start">
                  <span className="font-bold">会計確定（複合）</span>
                  <span className="text-xs opacity-80">現金 ¥{combinedCashNum.toLocaleString()} ＋ クレペイ ¥{combinedCashlessNum.toLocaleString()}</span>
                </div>
              </Button>
            </>
          ))}
          </>)}
          {/* ここまで会計セクション。以下の席操作ボタンは畳んでも常に出す */}

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

          {/* 未会計オーダーが1件も無いのに「使用中」で固まった席の復旧口。
              会計後の席ステータス同期に失敗した場合や、連結だけして注文が入らなかった場合に
              バッシング完了ボタンが出ず空席に戻せなくなるのを防ぐ。 */}
          {selectedBlock.status === "occupied" && unpaidItems.length === 0 && (
            <Button
              size="lg"
              variant="outline"
              className="h-14 w-full"
              onClick={onBussingComplete}
            >
              <RotateCcw className="mr-2 h-5 w-5" />
              <div className="flex flex-col items-start">
                <span className="font-bold">空席に戻す</span>
                <span className="text-xs opacity-80">未会計のオーダーがありません</span>
              </div>
            </Button>
          )}

          {(selectedBlock.status === "empty" || selectedBlock.status === "reserved") && (
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

      {/* ── 個別会計（分割会計）モーダル ────────────────────────────── */}
      {showSplitModal && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 sm:items-center">
          <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-t-2xl bg-card shadow-2xl sm:mx-4 sm:rounded-2xl">
            {/* ヘッダー */}
            <div className="flex items-center justify-between border-b border-border p-4">
              <div className="flex items-center gap-2">
                <Split className="h-5 w-5 text-info" />
                <h3 className="font-bold">個別会計</h3>
                {splitRounds !== null && (
                  <span className="rounded-full bg-info/20 px-2 py-0.5 text-xs font-bold text-info">
                    {splitRoundIndex + 1}回目 / 全{splitRounds}回
                  </span>
                )}
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCloseSplitModal}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {splitRounds === null ? (
              /* 1画面目: 支払い回数の選択 */
              <div className="p-4">
                <p className="mb-1 font-semibold">何回に分けて支払いますか？</p>
                <p className="mb-4 text-xs text-muted-foreground">
                  回数を選ぶと、1回ごとに対象のオーダーを選んで会計できます
                </p>
                <div className="grid grid-cols-5 gap-2">
                  {[2, 3, 4, 5, 6].map((n) => (
                    <Button
                      key={n}
                      variant="outline"
                      className="h-14 flex-col gap-0"
                      // 1回につき最低1品は要るため、品数より多い分割は選べない
                      disabled={n > totalOrderedQty}
                      onClick={() => handleSelectSplitRounds(n)}
                    >
                      <span className="text-lg font-bold">{n}</span>
                      <span className="text-[10px] text-muted-foreground">分割</span>
                    </Button>
                  ))}
                </div>
                <p className="mt-4 text-xs text-muted-foreground">
                  合計 ¥{unpaidItems.reduce((s, i) => s + i.subtotal, 0).toLocaleString()}（税抜） / {totalOrderedQty}点
                </p>
              </div>
            ) : (
              <>
                {/* 2画面目: この回に含めるオーダーを選ぶ */}
                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  {isFinalSplitRound ? (
                    <p className="mb-3 rounded-lg bg-warning/15 p-2 text-xs font-medium text-warning">
                      最終回のため、残りのオーダーすべてが対象です
                    </p>
                  ) : (
                    <p className="mb-3 text-xs text-muted-foreground">
                      人数で均等に振り分けた状態です。変えたい場合は数量の[−][+]で調整、
                      行をタップするとその明細ごと選択/解除できます
                    </p>
                  )}
                  <OrderItemSelectList
                    items={unpaidItems}
                    quantities={splitQtyById}
                    locked={isFinalSplitRound}
                    qtyLabel="この回に含める数"
                    happyHour={happyHour}
                    isHhTarget={isHhTarget}
                    onToggle={handleSplitToggle}
                    onQtyChange={handleSplitQtyChange}
                  />
                </div>

                {/* フッター: 金額と支払い方法 */}
                <div className="space-y-3 border-t border-border p-4">
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between font-bold">
                      <span>この回の合計（税込）</span>
                      <span>¥{totalAmount.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>残り {splitRemainingUnits}点</span>
                      <span>税抜 ¥{splitRemainingSubtotal.toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      size="lg"
                      className="h-14 bg-success text-primary-foreground hover:bg-success/90"
                      disabled={splitSelectedIds.length === 0 || totalAmount === 0}
                      onClick={() => {
                        setShowSplitModal(false)
                        handleCheckoutCash()
                      }}
                    >
                      <Banknote className="mr-2 h-5 w-5" />
                      <span className="font-bold">現金</span>
                    </Button>
                    <Button
                      size="lg"
                      className="h-14 bg-info text-foreground hover:bg-info/90"
                      disabled={splitSelectedIds.length === 0 || totalAmount === 0}
                      onClick={() => {
                        setShowSplitModal(false)
                        setShowCashlessModal(true)
                      }}
                    >
                      <CreditCard className="mr-2 h-5 w-5" />
                      <span className="font-bold">クレペイ</span>
                    </Button>
                  </div>
                  {/* 複合会計は金額入力が要るためサイドバー側の入力欄へ引き継ぐ */}
                  <Button
                    variant="outline"
                    className="h-11 w-full"
                    disabled={splitSelectedIds.length === 0 || totalAmount === 0}
                    onClick={() => {
                      setShowSplitModal(false)
                      setCombinedMode(true)
                      // 金額入力欄は会計セクション内にあるため開いておく
                      setCheckoutOpen(true)
                    }}
                  >
                    <Banknote className="mr-1.5 h-4 w-4" />
                    <CreditCard className="mr-2 h-4 w-4" />
                    <span className="text-sm font-bold">複合（現金＋クレペイ）で払う</span>
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── 連結解除: 解除する席へ移すオーダーを選ぶ ─────────────────── */}
      {unlinkTargetId && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 sm:items-center">
          <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-t-2xl bg-card shadow-2xl sm:mx-4 sm:rounded-2xl">
            <div className="flex items-center justify-between border-b border-border p-4">
              <div className="flex items-center gap-2">
                <Link2 className="h-5 w-5 text-info" />
                <h3 className="font-bold">
                  連結解除：{blocks.find((b) => b.id === unlinkTargetId)?.name ?? "席"}
                </h3>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setUnlinkTargetId(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <p className="mb-3 text-xs text-muted-foreground">
                解除する席へ移すオーダーを選んでください。選ばなかったぶんはこの伝票に残ります。
              </p>
              {unpaidItems.length > 0 ? (
                <OrderItemSelectList
                  items={unpaidItems}
                  quantities={unlinkQty}
                  qtyLabel="移すぶんの数"
                  happyHour={happyHour}
                  isHhTarget={isHhTarget}
                  onToggle={handleUnlinkToggle}
                  onQtyChange={handleUnlinkQtyChange}
                />
              ) : (
                <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border">
                  <p className="text-sm text-muted-foreground">未会計のオーダーはありません</p>
                </div>
              )}
            </div>

            <div className="space-y-3 border-t border-border p-4">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">移すオーダー</span>
                <span className="font-bold">
                  {Object.values(unlinkQty).reduce((sum, q) => sum + q, 0)}点
                </span>
              </div>
              <Button size="lg" className="h-14 w-full" onClick={handleConfirmUnlink}>
                <Link2 className="mr-2 h-5 w-5" />
                <span className="font-bold">この内容で連結を解除</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── キャッシュレス支払い方法選択 ─────────────────────────────── */}
      {showCashlessModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50">
          <div
            className="mx-4 w-full max-w-xs rounded-xl bg-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-bold">支払い方法を選択</h3>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowCashlessModal(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <p className="mb-4 text-center text-lg font-bold">¥{totalAmount.toLocaleString()}</p>
            <div className="space-y-2">
              <Button
                size="lg"
                className="h-14 w-full bg-info text-foreground hover:bg-info/90"
                onClick={() => {
                  setShowCashlessModal(false)
                  handleCheckoutCashless()
                }}
              >
                <CreditCard className="mr-2 h-5 w-5" />
                <div className="flex flex-col items-start">
                  <span className="font-bold">カード決済</span>
                  <span className="text-xs opacity-70">
                    {SQUARE_APP_ID ? "Squareアプリで処理" : "Square端末で処理"}
                  </span>
                </div>
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-14 w-full"
                onClick={() => {
                  setShowCashlessModal(false)
                  setShowPayPayQr(true)
                }}
              >
                <span className="mr-2 text-xl font-black text-[#e2103c]">P</span>
                <div className="flex flex-col items-start">
                  <span className="font-bold">PayPay</span>
                  <span className="text-xs text-muted-foreground">QRコード決済</span>
                </div>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── PayPay QRコード表示モーダル ─────────────────────────────── */}
      {showPayPayQr && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50">
          <div
            className="mx-4 w-full max-w-xs rounded-xl bg-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-bold">PayPayで支払い</h3>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowPayPayQr(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <p className="mb-3 text-center text-2xl font-bold">¥{totalAmount.toLocaleString()}</p>
            {/* 店舗別QR（/paypay-qr-<storeId>.jpg）があれば優先し、なければ共通QRを表示 */}
            <img
              src={`/paypay-qr-${storeId}.jpg`}
              alt="PayPay QRコード"
              className="mx-auto w-full max-w-[240px] rounded-lg bg-white"
              onError={(e) => {
                const img = e.currentTarget
                if (!img.src.endsWith("/paypay-qr.jpg")) img.src = "/paypay-qr.jpg"
              }}
            />
            <p className="mt-3 text-center text-xs text-muted-foreground">
              お客様にスキャンして金額を入力してもらい、支払い完了画面を確認してください
            </p>
            <div className="mt-4 space-y-2">
              <Button
                size="lg"
                className="h-12 w-full"
                onClick={() => {
                  handleCheckoutPayPay()
                  setShowPayPayQr(false)
                }}
              >
                <Check className="mr-2 h-5 w-5" />
                支払いを確認した（会計を記録）
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setShowPayPayQr(false)
                  setShowCashlessModal(true)
                }}
              >
                戻る
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── ナイトチャージ警告ポップアップ ──────────────────────────── */}
      {showNightChargeWarning && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-xs rounded-xl bg-card p-6 shadow-2xl">
            <div className="mb-1 flex items-center gap-2 text-destructive">
              <Zap className="h-5 w-5" />
              <span className="font-bold">HH選択不可</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              ナイトチャージが含まれているため、ハッピーアワーは選択できません。
            </p>
            <Button className="mt-4 w-full" onClick={() => setShowNightChargeWarning(false)}>
              閉じる
            </Button>
          </div>
        </div>
      )}

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
