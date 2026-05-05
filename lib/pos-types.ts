export type BlockStatus = "empty" | "reserved" | "occupied" | "checked_out"
export type BlockType = "chair" | "sofa" | "counter" | "private_room" | "wall" | "counter_equipment" | "passage"
export type ServingStatus = "unserved" | "served"
export type DiscountType = "amount" | "rate"

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
  paidItemIds: string[]
  couponId?: string
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
