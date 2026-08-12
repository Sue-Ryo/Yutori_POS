export type BlockStatus = "empty" | "reserved" | "occupied" | "checked_out"
export type BlockType = "chair" | "sofa" | "counter" | "private_room" | "wall" | "counter_equipment" | "passage"
export type ServingStatus = "unserved" | "served"
export type DiscountType = "fixed" | "percent" | "free_drink"

export interface ServiceBlock {
  id: string
  name: string
  blockType: BlockType
  x: number
  y: number
  width: number
  height: number
  rotation: number
  status: BlockStatus
  capacity: number
  startedAt?: Date
  checkedOutAt?: Date
}

export interface OrderItem {
  id: string
  productId: string
  category?: string
  name: string
  price: number
  quantity: number
  subtotal: number
  optionMemo?: string
  servingStatus: ServingStatus
  servedAt?: Date
  orderedAt: Date
  isPaid: boolean
  paidAt?: Date
  paymentId?: string
  originBlockId?: string
}

export interface Product {
  id: string
  category: string
  name: string
  price: number
  isActive: boolean
  displayOrder: number
}

export interface Coupon {
  id: string
  name: string
  discountType: DiscountType
  discountValue: number
  validFrom?: string
  validTo?: string
  isActive: boolean
}

export interface BlockSession {
  id: string
  blockId: string
  linkedBlockIds?: string[]
  orderItems: OrderItem[]
  startedAt: Date
  endedAt?: Date
  guestCount: number
  note?: string
  customerName?: string
  happyHour?: boolean
  /** その来店が新規客かどうか。会計時に Payment へコピーされる */
  isNewCustomer?: boolean
}

export interface CheckoutData {
  cashAmount: number
  cashlessAmount: number
  discountAmount: number
  taxAmount: number
  totalAmount: number
  couponId?: string
  guestCount: number
  paidItemIds: string[]
  /**
   * 同一商品をまとめた明細のうち、この会計で支払う数量（明細ID → 数量）。
   * 全数を支払う明細は省略される。一部だけ支払う場合は会計時に明細を分割する。
   */
  paidItemQuantities?: Record<string, number>
  customerName?: string
  sessionStartedAt?: Date
  squarePaymentId?: string
  isNewCustomer?: boolean
}

export interface Payment {
  id: string
  sessionId: string
  blockId: string
  paymentDatetime: Date
  businessDate: string
  subtotalAmount: number
  discountAmount: number
  taxAmount: number
  totalAmount: number
  cashAmount: number
  cashlessAmount: number
  guestCount: number
  note?: string
  canceledAt?: Date
  cancelReason?: string
  paidItemIds?: string[]
  couponId?: string
  customerName?: string
  sessionStartedAt?: Date
  syncedToSheetAt?: Date
  squarePaymentId?: string
  /** 新規客の来店だったか。日報・スプレッドシートの新規集計に使う */
  isNewCustomer?: boolean
  /**
   * ハッピーアワーを適用した会計か。会計時に session からコピーする。
   * session 側は下膳で false に戻る（stripGuestInfo）ため、履歴はこちらが正。
   * 列追加前の古い会計は undefined になる
   */
  happyHour?: boolean
}

export interface LayoutElement {
  id: string
  type: "counter" | "wall"
  x: number
  y: number
  width: number
  height: number
  rotation: number
  label?: string
}

export interface BusinessSettings {
  storeName: string
  businessDayStartTime: string
  taxRate: number
  checkedOutDisplaySeconds: number
}

export interface DailyExpense {
  businessDate: string
  receiptCount: number
  amount: number
  updatedAt: Date
  handoverNote: string
}
