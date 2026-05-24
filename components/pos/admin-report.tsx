"use client"

import { useState, useCallback, useEffect } from "react"
import { cn } from "@/lib/utils"
import type {
  Payment,
  BusinessSettings,
  Product,
  Coupon,
  DiscountType,
  DailyExpense,
} from "@/lib/pos-types"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  DollarSign,
  Banknote,
  CreditCard,
  Users,
  TrendingUp,
  Receipt,
  Undo2,
  Calculator,
  Store,
  BarChart2,
  Package,
  Tag,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  FolderPlus,
  ToggleLeft,
  ToggleRight,
  Sheet,
  RefreshCw,
  LogOut,
} from "lucide-react"
import { getBusinessDate } from "@/lib/pos-store"
import { clearSession } from "@/lib/session"
import { hashPin, verifyPin } from "@/lib/pin"
import { fetchStores, updatePinHash } from "@/lib/api/stores-db"

type AdminTab = "daily" | "products" | "coupons" | "settings"
type Period = "day" | "week" | "month"

const PERIOD_OPTIONS: { id: Period; label: string }[] = [
  { id: "day", label: "1日" },
  { id: "week", label: "1週間" },
  { id: "month", label: "1か月" },
]

interface AdminReportProps {
  storeId: number
  payments: Payment[]
  settings: BusinessSettings
  products: Product[]
  coupons: Coupon[]
  expenses: DailyExpense[]
  onCancelPayment: (paymentId: string) => void
  onUpdateSettings: (settings: BusinessSettings) => void
  onUpdateProducts: (products: Product[]) => void
  onUpdateCoupons: (coupons: Coupon[]) => void
  onMarkPaymentsSynced: (ids: string[], syncedAt: Date) => void
  onUpsertExpense: (expense: DailyExpense) => Promise<void>
}

// ── 商品マスタタブ ─────────────────────────────────────────────────────
function ProductsTab({
  products,
  onUpdateProducts,
}: {
  products: Product[]
  onUpdateProducts: (p: Product[]) => void
}) {
  const [editingProductId, setEditingProductId] = useState<string | null>(null)
  const [addingCategory, setAddingCategory] = useState<string | null>(null) // カテゴリ名
  const [showNewCategoryInput, setShowNewCategoryInput] = useState(false)

  // 新規商品フォームの初期値
  const emptyProductForm = { name: "", price: "" }
  const [productForm, setProductForm] = useState(emptyProductForm)

  // 新規カテゴリ名入力フォーム
  const [newCategoryName, setNewCategoryName] = useState("")

  // products から一意のカテゴリリストを生成（displayOrder昇順）
  const categoryNames: string[] = []
  const seenCats = new Set<string>()
  products
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .forEach((p) => {
      if (p.category && !seenCats.has(p.category)) {
        seenCats.add(p.category)
        categoryNames.push(p.category)
      }
    })

  const handleAddNewCategory = () => {
    const name = newCategoryName.trim()
    if (!name || seenCats.has(name)) return
    setNewCategoryName("")
    setShowNewCategoryInput(false)
    setAddingCategory(name)
    setProductForm(emptyProductForm)
  }

  const handleDeleteCategory = (catName: string) => {
    onUpdateProducts(products.filter((p) => p.category !== catName))
  }

  const handleAddProduct = (catName: string) => {
    if (!productForm.name.trim() || !productForm.price) return
    const catProducts = products.filter((p) => p.category === catName)
    const maxOrder = catProducts.length > 0
      ? Math.max(...catProducts.map((p) => p.displayOrder))
      : products.length
    const newProduct: Product = {
      id: `p-${Date.now()}`,
      category: catName,
      name: productForm.name.trim(),
      price: Number(productForm.price),
      isActive: true,
      displayOrder: maxOrder + 1,
    }
    onUpdateProducts([...products, newProduct])
    setProductForm(emptyProductForm)
    setAddingCategory(null)
  }

  const handleToggleActive = (id: string) => {
    onUpdateProducts(
      products.map((p) => (p.id === id ? { ...p, isActive: !p.isActive } : p)),
    )
  }

  const handleDeleteProduct = (id: string) => {
    onUpdateProducts(products.filter((p) => p.id !== id))
    if (editingProductId === id) setEditingProductId(null)
  }

  const handleSaveProduct = (id: string, name: string, price: string, category: string) => {
    if (!name.trim() || !price || !category.trim()) return
    onUpdateProducts(
      products.map((p) =>
        p.id === id ? { ...p, name: name.trim(), price: Number(price), category: category.trim() } : p,
      ),
    )
    setEditingProductId(null)
  }

  // 新規カテゴリ追加中もリストに含める
  const displayCategories = addingCategory && !seenCats.has(addingCategory)
    ? [...categoryNames, addingCategory]
    : categoryNames

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">商品マスタ</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setShowNewCategoryInput(true); setNewCategoryName("") }}
        >
          <FolderPlus className="mr-1 h-4 w-4" />
          カテゴリ追加
        </Button>
      </div>

      {/* 新規カテゴリ名入力フォーム */}
      {showNewCategoryInput && (
        <Card className="border-primary/40">
          <CardContent className="flex items-center gap-2 py-3">
            <Input
              autoFocus
              placeholder="カテゴリ名"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              className="h-8"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddNewCategory()
                if (e.key === "Escape") setShowNewCategoryInput(false)
              }}
            />
            <Button size="sm" onClick={handleAddNewCategory}>
              <Check className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setShowNewCategoryInput(false); setNewCategoryName("") }}
            >
              <X className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}

      {displayCategories.map((catName) => {
        const catProducts = products
          .filter((p) => p.category === catName)
          .sort((a, b) => a.displayOrder - b.displayOrder)

        return (
          <Card key={catName}>
            <CardHeader className="py-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">{catName}</CardTitle>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      setAddingCategory(catName)
                      setProductForm(emptyProductForm)
                    }}
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    商品追加
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => handleDeleteCategory(catName)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-1.5 pb-3">
              {/* 商品追加フォーム */}
              {addingCategory === catName && (
                <div className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 p-2">
                  <Input
                    autoFocus
                    placeholder="商品名"
                    value={productForm.name}
                    onChange={(e) => setProductForm((f) => ({ ...f, name: e.target.value }))}
                    className="h-7 text-sm"
                  />
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-sm">¥</span>
                    <Input
                      type="number"
                      placeholder="0"
                      value={productForm.price}
                      onChange={(e) => setProductForm((f) => ({ ...f, price: e.target.value }))}
                      className="h-7 w-20 text-sm"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddProduct(catName)
                        if (e.key === "Escape") setAddingCategory(null)
                      }}
                    />
                  </div>
                  <Button size="sm" className="h-7 px-2 shrink-0" onClick={() => handleAddProduct(catName)}>
                    <Check className="h-3 w-3" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 shrink-0" onClick={() => setAddingCategory(null)}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              )}

              {/* 商品リスト */}
              {catProducts.length === 0 && addingCategory !== catName && (
                <p className="py-2 text-center text-xs text-muted-foreground">
                  商品がありません
                </p>
              )}
              {catProducts.map((product) =>
                editingProductId === product.id ? (
                  <EditProductRow
                    key={product.id}
                    product={product}
                    onSave={handleSaveProduct}
                    onCancel={() => setEditingProductId(null)}
                  />
                ) : (
                  <div
                    key={product.id}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors",
                      product.isActive ? "bg-muted/30" : "bg-muted/10 opacity-50",
                    )}
                  >
                    <span className="flex-1 text-sm font-medium">{product.name}</span>
                    <span className="text-sm text-muted-foreground">
                      ¥{product.price.toLocaleString()}
                    </span>
                    <button
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => handleToggleActive(product.id)}
                      title={product.isActive ? "無効にする" : "有効にする"}
                    >
                      {product.isActive ? (
                        <ToggleRight className="h-4 w-4 text-success" />
                      ) : (
                        <ToggleLeft className="h-4 w-4" />
                      )}
                    </button>
                    <button
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => setEditingProductId(product.id)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      className="text-destructive hover:text-destructive/80"
                      onClick={() => handleDeleteProduct(product.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ),
              )}
            </CardContent>
          </Card>
        )
      })}

      {displayCategories.length === 0 && (
        <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-border">
          <p className="text-muted-foreground text-sm">「カテゴリ追加」からカテゴリを作成してください</p>
        </div>
      )}
    </div>
  )
}

function EditProductRow({
  product,
  onSave,
  onCancel,
}: {
  product: Product
  onSave: (id: string, name: string, price: string, category: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(product.name)
  const [price, setPrice] = useState(String(product.price))
  const [category, setCategory] = useState(product.category)

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-primary/40 bg-primary/5 p-2">
      <div className="flex items-center gap-1.5">
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-7 flex-1 text-sm"
          placeholder="商品名"
        />
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-sm">¥</span>
          <Input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="h-7 w-20 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter") onSave(product.id, name, price, category)
              if (e.key === "Escape") onCancel()
            }}
          />
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <Input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-7 flex-1 text-sm"
          placeholder="カテゴリ名"
        />
        <Button size="sm" className="h-7 px-2 shrink-0" onClick={() => onSave(product.id, name, price, category)}>
          <Check className="h-3 w-3" />
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 shrink-0" onClick={onCancel}>
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
}

// ── クーポンタブ ──────────────────────────────────────────────────────
function CouponsTab({
  coupons,
  onUpdateCoupons,
}: {
  coupons: Coupon[]
  onUpdateCoupons: (c: Coupon[]) => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const emptyCouponForm = {
    name: "",
    discountType: "amount" as DiscountType,
    discountValue: "",
  }
  const [form, setForm] = useState(emptyCouponForm)

  const handleAdd = () => {
    if (!form.name.trim() || !form.discountValue) return
    const newCoupon: Coupon = {
      id: `c-${Date.now()}`,
      name: form.name.trim(),
      discountType: form.discountType,
      discountValue: Number(form.discountValue),
      isActive: true,
    }
    onUpdateCoupons([...coupons, newCoupon])
    setForm(emptyCouponForm)
    setAdding(false)
  }

  const handleToggleActive = (id: string) => {
    onUpdateCoupons(
      coupons.map((c) => (c.id === id ? { ...c, isActive: !c.isActive } : c)),
    )
  }

  const handleDelete = (id: string) => {
    onUpdateCoupons(coupons.filter((c) => c.id !== id))
    if (editingId === id) setEditingId(null)
  }

  const handleSave = (id: string, name: string, discountType: DiscountType, discountValue: string) => {
    if (!name.trim() || !discountValue) return
    onUpdateCoupons(
      coupons.map((c) =>
        c.id === id
          ? { ...c, name: name.trim(), discountType, discountValue: Number(discountValue) }
          : c,
      ),
    )
    setEditingId(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">クーポンマスタ</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setAdding(true); setForm(emptyCouponForm) }}
        >
          <Plus className="mr-1 h-4 w-4" />
          クーポン追加
        </Button>
      </div>

      {/* 追加フォーム */}
      {adding && (
        <CouponForm
          form={form}
          setForm={setForm}
          onSave={handleAdd}
          onCancel={() => { setAdding(false); setForm(emptyCouponForm) }}
        />
      )}

      {/* クーポン一覧 */}
      <Card>
        <CardContent className="py-3">
          {coupons.length === 0 && !adding ? (
            <div className="flex h-24 items-center justify-center">
              <p className="text-sm text-muted-foreground">クーポンがありません</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {coupons.map((coupon) =>
                editingId === coupon.id ? (
                  <EditCouponRow
                    key={coupon.id}
                    coupon={coupon}
                    onSave={handleSave}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <div
                    key={coupon.id}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-2",
                      coupon.isActive ? "bg-muted/30" : "bg-muted/10 opacity-50",
                    )}
                  >
                    <Tag className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 text-sm font-medium">{coupon.name}</span>
                    <span className="text-sm text-muted-foreground">
                      {coupon.discountType === "amount"
                        ? `−¥${coupon.discountValue.toLocaleString()}`
                        : `−${coupon.discountValue}%`}
                    </span>
                    <button
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => handleToggleActive(coupon.id)}
                    >
                      {coupon.isActive ? (
                        <ToggleRight className="h-4 w-4 text-success" />
                      ) : (
                        <ToggleLeft className="h-4 w-4" />
                      )}
                    </button>
                    <button
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => setEditingId(coupon.id)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      className="text-destructive hover:text-destructive/80"
                      onClick={() => handleDelete(coupon.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ),
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function CouponForm({
  form,
  setForm,
  onSave,
  onCancel,
}: {
  form: { name: string; discountType: DiscountType; discountValue: string }
  setForm: React.Dispatch<
    React.SetStateAction<{ name: string; discountType: DiscountType; discountValue: string }>
  >
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <Card className="border-primary/40">
      <CardContent className="space-y-2 py-3">
        <div>
          <Label className="text-xs text-muted-foreground">クーポン名</Label>
          <Input
            autoFocus
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="例: ウェルカムクーポン"
            className="mt-1 h-8"
          />
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <Label className="text-xs text-muted-foreground">割引種別</Label>
            <select
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              value={form.discountType}
              onChange={(e) =>
                setForm((f) => ({ ...f, discountType: e.target.value as DiscountType }))
              }
            >
              <option value="amount">金額割引 (円)</option>
              <option value="rate">率割引 (%)</option>
            </select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">割引値</Label>
            <div className="mt-1 flex items-center gap-1">
              <Input
                type="number"
                value={form.discountValue}
                onChange={(e) => setForm((f) => ({ ...f, discountValue: e.target.value }))}
                placeholder="0"
                className="h-8 w-24"
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSave()
                  if (e.key === "Escape") onCancel()
                }}
              />
              <span className="text-sm text-muted-foreground">
                {form.discountType === "amount" ? "円" : "%"}
              </span>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button size="sm" onClick={onSave}>
            <Check className="mr-1 h-3 w-3" />
            追加
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            キャンセル
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function EditCouponRow({
  coupon,
  onSave,
  onCancel,
}: {
  coupon: Coupon
  onSave: (id: string, name: string, discountType: DiscountType, discountValue: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(coupon.name)
  const [discountType, setDiscountType] = useState<DiscountType>(coupon.discountType)
  const [discountValue, setDiscountValue] = useState(String(coupon.discountValue))

  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 p-2">
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="h-7 flex-1 text-sm"
      />
      <select
        className="h-7 rounded-md border border-border bg-background px-1.5 text-xs"
        value={discountType}
        onChange={(e) => setDiscountType(e.target.value as DiscountType)}
      >
        <option value="amount">円</option>
        <option value="rate">%</option>
      </select>
      <Input
        type="number"
        value={discountValue}
        onChange={(e) => setDiscountValue(e.target.value)}
        className="h-7 w-16 text-sm"
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave(coupon.id, name, discountType, discountValue)
          if (e.key === "Escape") onCancel()
        }}
      />
      <Button size="sm" className="h-7 px-2 shrink-0" onClick={() => onSave(coupon.id, name, discountType, discountValue)}>
        <Check className="h-3 w-3" />
      </Button>
      <Button size="sm" variant="ghost" className="h-7 px-2 shrink-0" onClick={onCancel}>
        <X className="h-3 w-3" />
      </Button>
    </div>
  )
}

// ── 経費入力カード ────────────────────────────────────────────────────
function ExpenseCard({
  todayBD,
  expenses,
  onUpsertExpense,
}: {
  todayBD: string
  expenses: DailyExpense[]
  onUpsertExpense: (expense: DailyExpense) => Promise<void>
}) {
  const [selectedDate, setSelectedDate] = useState(todayBD)
  const [receiptCount, setReceiptCount] = useState(0)
  const [amount, setAmount] = useState(0)
  const [handoverNote, setHandoverNote] = useState("")
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | undefined>()

  useEffect(() => {
    const exp = expenses.find((e) => e.businessDate === selectedDate)
    setReceiptCount(exp?.receiptCount ?? 0)
    setAmount(exp?.amount ?? 0)
    setHandoverNote(exp?.handoverNote ?? "")
    setSavedAt(exp?.updatedAt)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate])

  const handleSave = async () => {
    setSaving(true)
    try {
      const now = new Date()
      await onUpsertExpense({ businessDate: selectedDate, receiptCount, amount, handoverNote, updatedAt: now })
      setSavedAt(now)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg bg-muted p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-destructive">
          <Calculator className="h-4 w-4" />
          <span className="text-sm">経費</span>
        </div>
        <input
          type="date"
          value={selectedDate}
          max={todayBD}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="h-7 rounded-md border border-border bg-background px-2 text-xs"
        />
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          value={receiptCount}
          min={0}
          onChange={(e) => setReceiptCount(Math.max(0, Number(e.target.value)))}
          className="h-8 w-14 bg-background text-center"
          placeholder="0"
        />
        <span className="shrink-0 text-xs text-muted-foreground">枚</span>
        <span className="shrink-0 text-muted-foreground">¥</span>
        <Input
          type="number"
          value={amount}
          min={0}
          onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))}
          className="h-8 flex-1 bg-background"
        />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Input
          className="h-8 flex-1 bg-background text-sm"
          placeholder="引継ぎメモ（次のシフトへの申し送り）"
          value={handoverNote}
          onChange={(e) => setHandoverNote(e.target.value)}
        />
        <Button size="sm" className="h-8 shrink-0 px-3" onClick={handleSave} disabled={saving}>
          {saving ? <RefreshCw className="h-3 w-3 animate-spin" /> : "保存"}
        </Button>
      </div>
      {savedAt && (
        <p className="mt-1.5 text-right text-xs text-muted-foreground">
          最終更新: {savedAt.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
        </p>
      )}
    </div>
  )
}

// ── メインコンポーネント ──────────────────────────────────────────────
export function AdminReport({
  storeId,
  payments,
  settings,
  products,
  coupons,
  expenses,
  onCancelPayment,
  onUpdateSettings,
  onUpdateProducts,
  onUpdateCoupons,
  onMarkPaymentsSynced,
  onUpsertExpense,
}: AdminReportProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>("daily")
  const [period, setPeriod] = useState<Period>("day")
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{ count: number; error?: string } | null>(null)

  const unsyncedCount = payments.filter((p) => !p.syncedToSheetAt && !p.canceledAt).length

  const handleManualSync = useCallback(async () => {
    setSyncing(true)
    setSyncResult(null)
    try {
      const unsynced = payments.filter((p) => !p.syncedToSheetAt && !p.canceledAt)
      const res = await fetch("/api/sheets/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payments: unsynced }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "同期に失敗しました")
      const syncedIds: string[] = json.syncedIds ?? []
      if (syncedIds.length > 0) {
        onMarkPaymentsSynced(syncedIds, new Date())
      }
      setSyncResult({ count: syncedIds.length })
    } catch (err) {
      setSyncResult({ count: 0, error: String(err) })
    } finally {
      setSyncing(false)
    }
  }, [payments, onMarkPaymentsSynced])

  const todayBD = getBusinessDate(new Date(), settings.businessDayStartTime)

  const periodStart = (() => {
    if (period === "day") return todayBD
    const d = new Date()
    d.setDate(d.getDate() - (period === "week" ? 6 : 29))
    return getBusinessDate(d, settings.businessDayStartTime)
  })()

  const periodLabel = period === "day" ? "本日" : period === "week" ? "過去7日間" : "過去30日間"

  const periodPayments = payments.filter((p) =>
    period === "day" ? p.businessDate === todayBD : p.businessDate >= periodStart && p.businessDate <= todayBD
  )

  const activePayments = periodPayments.filter((p) => !p.canceledAt)
  const totalSales = activePayments.reduce((sum, p) => sum + p.totalAmount, 0)
  const cashSales = activePayments.reduce((sum, p) => sum + p.cashAmount, 0)
  const cashlessSales = activePayments.reduce((sum, p) => sum + p.cashlessAmount, 0)
  const totalGuests = activePayments.reduce((sum, p) => sum + p.guestCount, 0)
  const groupCount = activePayments.length
  const avgPerGuest = totalGuests > 0 ? Math.round(totalSales / totalGuests) : 0
  const periodExpenses = expenses
    .filter((e) =>
      period === "day"
        ? e.businessDate === todayBD
        : e.businessDate >= periodStart && e.businessDate <= todayBD
    )
    .reduce((sum, e) => sum + e.amount, 0)
  const profit = totalSales - periodExpenses

  const formatDatetime = (d: Date) =>
    new Date(d).toLocaleString("ja-JP", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })


  const tabs: { id: AdminTab; label: string; icon: React.ReactNode }[] = [
    { id: "daily", label: "日計", icon: <TrendingUp className="h-4 w-4" /> },
    { id: "products", label: "商品マスタ", icon: <Package className="h-4 w-4" /> },
    { id: "coupons", label: "クーポン", icon: <Tag className="h-4 w-4" /> },
    { id: "settings", label: "店舗設定", icon: <Store className="h-4 w-4" /> },
  ]

  return (
    <div className="flex h-full flex-col">
      {/* タブ */}
      <div className="flex gap-1 rounded-lg bg-muted p-1 mb-4 shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              activeTab === tab.id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon}
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-6">

          {/* ── 日計タブ ── */}
          {activeTab === "daily" && (
            <>
              {/* 期間切り替え */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{periodLabel}</span>
                <div className="flex overflow-hidden rounded-md border border-border">
                  {PERIOD_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      className={cn(
                        "px-3 py-1.5 text-xs font-medium transition-colors",
                        period === opt.id
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted",
                      )}
                      onClick={() => setPeriod(opt.id)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Google Sheets 同期 */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Sheet className="h-5 w-5 text-success" />
                      スプレッドシート同期
                    </div>
                    <div className="flex items-center gap-2">
                      {unsyncedCount > 0 && (
                        <span className="rounded-full bg-warning/20 px-2 py-0.5 text-xs font-medium text-warning">
                          未同期 {unsyncedCount}件
                        </span>
                      )}
                      {unsyncedCount === 0 && (
                        <span className="rounded-full bg-success/20 px-2 py-0.5 text-xs font-medium text-success">
                          同期済
                        </span>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={handleManualSync}
                        disabled={syncing || unsyncedCount === 0}
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
                        {syncing ? "同期中..." : "今すぐ同期"}
                      </Button>
                    </div>
                  </CardTitle>
                  {syncResult && (
                    <p className={`text-xs mt-1 ${syncResult.error ? "text-destructive" : "text-success"}`}>
                      {syncResult.error ?? `${syncResult.count}件をスプレッドシートに送信しました`}
                    </p>
                  )}
                </CardHeader>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-primary" />
                    レポート
                  </CardTitle>
                  <CardDescription>{periodLabel}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <StatCard
                      icon={<DollarSign className="h-4 w-4" />}
                      label="売上合計"
                      value={`¥${totalSales.toLocaleString()}`}
                    />
                    <StatCard
                      icon={<Banknote className="h-4 w-4 text-success" />}
                      label="現金"
                      value={`¥${cashSales.toLocaleString()}`}
                      valueClass="text-success"
                    />
                    <StatCard
                      icon={<CreditCard className="h-4 w-4 text-info" />}
                      label="クレペイ"
                      value={`¥${cashlessSales.toLocaleString()}`}
                      valueClass="text-info"
                    />
                    <StatCard
                      icon={<Users className="h-4 w-4" />}
                      label="客数 / 組数"
                      value={`${totalGuests}名 / ${groupCount}組`}
                    />
                    <StatCard
                      icon={<BarChart2 className="h-4 w-4" />}
                      label="客単価"
                      value={`¥${avgPerGuest.toLocaleString()}`}
                    />
                    {/* 経費 */}
                    <ExpenseCard
                      todayBD={todayBD}
                      expenses={expenses}
                      onUpsertExpense={onUpsertExpense}
                    />
                    <div className="col-span-full rounded-lg bg-primary/10 p-4">
                      <div className="flex items-center gap-2 text-primary">
                        <TrendingUp className="h-4 w-4" />
                        <span className="text-sm font-semibold">利益</span>
                      </div>
                      <p className="mt-2 text-2xl font-bold text-primary">
                        ¥{profit.toLocaleString()}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* 会計履歴 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Receipt className="h-5 w-5 text-primary" />
                    会計履歴
                  </CardTitle>
                  <CardDescription>{periodLabel}の会計済み一覧</CardDescription>
                </CardHeader>
                <CardContent>
                  {periodPayments.length === 0 ? (
                    <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-border">
                      <p className="text-muted-foreground">会計済みの記録はありません</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {periodPayments.map((payment) => (
                        <div
                          key={payment.id}
                          className={cn(
                            "flex items-center justify-between rounded-lg border border-border p-4",
                            payment.canceledAt && "opacity-50",
                          )}
                        >
                          <div className="flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold">
                                #{payment.id.slice(-6)}
                              </span>
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-xs font-medium",
                                  payment.cashAmount > 0 && payment.cashlessAmount === 0
                                    ? "bg-success/20 text-success"
                                    : "bg-info/20 text-info",
                                )}
                              >
                                {payment.cashAmount > 0 && payment.cashlessAmount === 0
                                  ? "現金"
                                  : "クレペイ"}
                              </span>
                              {payment.canceledAt && (
                                <span className="rounded-full bg-destructive/20 px-2 py-0.5 text-xs text-destructive">
                                  取消済
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {formatDatetime(payment.paymentDatetime)} •{" "}
                              {payment.guestCount}名
                              {payment.discountAmount > 0 &&
                                ` • 割引¥${payment.discountAmount.toLocaleString()}`}
                            </p>
                          </div>
                          <div className="flex items-center gap-4">
                            <span className="text-lg font-bold">
                              ¥{payment.totalAmount.toLocaleString()}
                            </span>
                            {!payment.canceledAt && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => onCancelPayment(payment.id)}
                                className="text-warning hover:bg-warning/10 hover:text-warning"
                              >
                                <Undo2 className="mr-1 h-4 w-4" />
                                取消
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}

          {/* ── 商品マスタタブ ── */}
          {activeTab === "products" && (
            <ProductsTab
              products={products}
              onUpdateProducts={onUpdateProducts}
            />
          )}

          {/* ── クーポンタブ ── */}
          {activeTab === "coupons" && (
            <CouponsTab
              coupons={coupons}
              onUpdateCoupons={onUpdateCoupons}
            />
          )}

          {/* ── 店舗設定タブ ── */}
          {activeTab === "settings" && (
            <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Store className="h-5 w-5 text-primary" />
                  店舗設定
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="store-name">店舗名</Label>
                    <Input
                      id="store-name"
                      value={settings.storeName}
                      onChange={(e) =>
                        onUpdateSettings({ ...settings, storeName: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="biz-start">営業開始時刻</Label>
                    <p className="text-xs text-muted-foreground">
                      この時刻を跨ぐまでを同一営業日として集計します
                    </p>
                    <Input
                      id="biz-start"
                      type="time"
                      value={settings.businessDayStartTime}
                      onChange={(e) =>
                        onUpdateSettings({ ...settings, businessDayStartTime: e.target.value })
                      }
                      className="w-36"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tax-rate">消費税率 (%)</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="tax-rate"
                        type="number"
                        min={0}
                        max={100}
                        value={settings.taxRate}
                        onChange={(e) =>
                          onUpdateSettings({
                            ...settings,
                            taxRate: Math.max(0, Number(e.target.value)),
                          })
                        }
                        className="w-24"
                      />
                      <span className="text-sm text-muted-foreground">%</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="checkout-display">会計済表示時間</Label>
                    <p className="text-xs text-muted-foreground">
                      会計済（青）ステータスを表示する秒数
                    </p>
                    <div className="flex items-center gap-2">
                      <Input
                        id="checkout-display"
                        type="number"
                        min={5}
                        value={settings.checkedOutDisplaySeconds}
                        onChange={(e) =>
                          onUpdateSettings({
                            ...settings,
                            checkedOutDisplaySeconds: Math.max(5, Number(e.target.value)),
                          })
                        }
                        className="w-24"
                      />
                      <span className="text-sm text-muted-foreground">秒</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <PinChangeCard storeId={storeId} />

            <Card className="border-destructive/40">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">ログアウト</p>
                    <p className="text-xs text-muted-foreground">店舗選択画面に戻ります</p>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => { clearSession(); window.location.reload() }}
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    ログアウト
                  </Button>
                </div>
              </CardContent>
            </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── PINコード変更カード ───────────────────────────────────────────────
function PinChangeCard({ storeId }: { storeId: number }) {
  const [currentPin, setCurrentPin] = useState("")
  const [newPin, setNewPin] = useState("")
  const [confirmPin, setConfirmPin] = useState("")
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)

  const handleSave = async () => {
    setMessage(null)
    if (newPin.length < 4) {
      setMessage({ type: "error", text: "新しいPINは4桁以上で入力してください" })
      return
    }
    if (newPin !== confirmPin) {
      setMessage({ type: "error", text: "新しいPINが一致しません" })
      return
    }
    setSaving(true)
    try {
      const stores = await fetchStores()
      const store = stores.find((s) => s.id === storeId)
      if (!store) throw new Error("店舗情報の取得に失敗しました")
      const ok = await verifyPin(currentPin, store.pinHash)
      if (!ok) {
        setMessage({ type: "error", text: "現在のPINが違います" })
        setCurrentPin("")
        return
      }
      const hash = await hashPin(newPin)
      await updatePinHash(storeId, hash)
      setMessage({ type: "success", text: "PINを変更しました" })
      setCurrentPin("")
      setNewPin("")
      setConfirmPin("")
    } catch (e) {
      setMessage({ type: "error", text: String(e) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">PINコード変更</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 max-w-xs">
          <div className="space-y-1">
            <Label className="text-xs">現在のPIN</Label>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={currentPin}
              onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ""))}
              placeholder="現在のPINを入力"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">新しいPIN（4〜6桁）</Label>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
              placeholder="新しいPINを入力"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">新しいPIN（確認）</Label>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
              placeholder="もう一度入力"
            />
          </div>
          {message && (
            <p className={`text-xs ${message.type === "error" ? "text-destructive" : "text-green-600"}`}>
              {message.text}
            </p>
          )}
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !currentPin || !newPin || !confirmPin}
          >
            {saving ? <RefreshCw className="mr-2 h-3 w-3 animate-spin" /> : null}
            変更を保存
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function StatCard({
  icon,
  label,
  value,
  valueClass,
}: {
  icon: React.ReactNode
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <div className="rounded-lg bg-muted p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      <p className={cn("mt-2 text-2xl font-bold", valueClass)}>{value}</p>
    </div>
  )
}
