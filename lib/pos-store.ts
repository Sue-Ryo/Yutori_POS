import type {
  ServiceBlock,
  BlockSession,
  LayoutElement,
  BusinessSettings,
  Product,
  Coupon,
  Payment,
} from "./pos-types"

export const products: Product[] = [
  { id: "p1", category: "シーシャ", name: "シーシャ（1本）", price: 1800, isActive: true, displayOrder: 1 },
  { id: "p2", category: "シーシャ", name: "フレーバー追加", price: 500, isActive: true, displayOrder: 2 },
  { id: "p3", category: "シーシャ", name: "炭追加", price: 300, isActive: true, displayOrder: 3 },
  { id: "p4", category: "ドリンク", name: "ソフトドリンク", price: 500, isActive: true, displayOrder: 4 },
  { id: "p5", category: "ドリンク", name: "アルコール", price: 700, isActive: true, displayOrder: 5 },
  { id: "p6", category: "ドリンク", name: "水", price: 300, isActive: true, displayOrder: 6 },
  { id: "p7", category: "フード", name: "おつまみ", price: 400, isActive: true, displayOrder: 7 },
  { id: "p8", category: "フード", name: "ナッツ盛合せ", price: 600, isActive: true, displayOrder: 8 },
]

export const coupons: Coupon[] = [
  { id: "c1", name: "ウェルカムクーポン", discountType: "amount", discountValue: 500, isActive: true },
  { id: "c2", name: "リピーター割引10%", discountType: "rate", discountValue: 10, isActive: true },
]

export const initialBlocks: ServiceBlock[] = [
  {
    id: "b1",
    name: "ソファ席A",
    blockType: "sofa",
    x: 50,
    y: 50,
    width: 120,
    height: 80,
    rotation: 0,
    status: "empty",
    capacity: 4,
  },
  {
    id: "b2",
    name: "ソファ席B",
    blockType: "sofa",
    x: 220,
    y: 50,
    width: 120,
    height: 80,
    rotation: 0,
    status: "occupied",
    capacity: 4,
    startedAt: new Date(Date.now() - 45 * 60000),
  },
  {
    id: "b3",
    name: "ソファ席C",
    blockType: "sofa",
    x: 390,
    y: 50,
    width: 120,
    height: 80,
    rotation: 0,
    status: "waiting",
    capacity: 2,
    startedAt: new Date(Date.now() - 30 * 60000),
  },
  {
    id: "b4",
    name: "カウンター1",
    blockType: "counter",
    x: 50,
    y: 190,
    width: 70,
    height: 70,
    rotation: 0,
    status: "empty",
    capacity: 1,
  },
  {
    id: "b5",
    name: "カウンター2",
    blockType: "counter",
    x: 140,
    y: 190,
    width: 70,
    height: 70,
    rotation: 0,
    status: "empty",
    capacity: 1,
  },
  {
    id: "b6",
    name: "個室",
    blockType: "private_room",
    x: 350,
    y: 190,
    width: 160,
    height: 100,
    rotation: 0,
    status: "occupied",
    capacity: 6,
    startedAt: new Date(Date.now() - 90 * 60000),
  },
]

export const initialLayoutElements: LayoutElement[] = [
  { id: "e1", type: "counter", x: 50, y: 360, width: 300, height: 40, rotation: 0, label: "カウンター設備" },
  { id: "e2", type: "wall", x: 330, y: 150, width: 10, height: 100, rotation: 0 },
]

export const initialSessions: BlockSession[] = [
  {
    id: "s1",
    blockId: "b2",
    orderItems: [
      {
        id: "i1",
        productId: "p1",
        name: "シーシャ（1本）",
        price: 1800,
        quantity: 1,
        subtotal: 1800,
        servingStatus: "served",
        servedAt: new Date(Date.now() - 40 * 60000),
        orderedAt: new Date(Date.now() - 44 * 60000),
        isPaid: false,
      },
      {
        id: "i2",
        productId: "p5",
        name: "アルコール",
        price: 700,
        quantity: 2,
        subtotal: 1400,
        servingStatus: "served",
        servedAt: new Date(Date.now() - 42 * 60000),
        orderedAt: new Date(Date.now() - 44 * 60000),
        isPaid: false,
      },
    ],
    startedAt: new Date(Date.now() - 45 * 60000),
    guestCount: 2,
  },
  {
    id: "s2",
    blockId: "b3",
    orderItems: [
      {
        id: "i3",
        productId: "p1",
        name: "シーシャ（1本）",
        price: 1800,
        quantity: 1,
        subtotal: 1800,
        servingStatus: "served",
        servedAt: new Date(Date.now() - 25 * 60000),
        orderedAt: new Date(Date.now() - 29 * 60000),
        isPaid: false,
      },
      {
        id: "i4",
        productId: "p4",
        name: "ソフトドリンク",
        price: 500,
        quantity: 1,
        subtotal: 500,
        servingStatus: "unserved",
        orderedAt: new Date(Date.now() - 5 * 60000),
        isPaid: false,
      },
    ],
    startedAt: new Date(Date.now() - 30 * 60000),
    guestCount: 2,
  },
  {
    id: "s3",
    blockId: "b6",
    orderItems: [
      {
        id: "i5",
        productId: "p1",
        name: "シーシャ（1本）",
        price: 1800,
        quantity: 2,
        subtotal: 3600,
        servingStatus: "served",
        servedAt: new Date(Date.now() - 85 * 60000),
        orderedAt: new Date(Date.now() - 89 * 60000),
        isPaid: false,
      },
      {
        id: "i6",
        productId: "p5",
        name: "アルコール",
        price: 700,
        quantity: 4,
        subtotal: 2800,
        servingStatus: "served",
        servedAt: new Date(Date.now() - 87 * 60000),
        orderedAt: new Date(Date.now() - 89 * 60000),
        isPaid: false,
      },
      {
        id: "i7",
        productId: "p8",
        name: "ナッツ盛合せ",
        price: 600,
        quantity: 1,
        subtotal: 600,
        servingStatus: "served",
        servedAt: new Date(Date.now() - 80 * 60000),
        orderedAt: new Date(Date.now() - 89 * 60000),
        isPaid: false,
      },
    ],
    startedAt: new Date(Date.now() - 90 * 60000),
    guestCount: 4,
  },
]

export const initialPayments: Payment[] = [
  {
    id: "pay1",
    sessionId: "prev1",
    blockId: "b1",
    paymentDatetime: new Date(Date.now() - 2 * 3600000),
    businessDate: new Date().toISOString().split("T")[0],
    subtotalAmount: 5200,
    discountAmount: 0,
    taxAmount: 520,
    totalAmount: 5720,
    cashAmount: 5720,
    cashlessAmount: 0,
    guestCount: 2,
    paidItemIds: [],
  },
  {
    id: "pay2",
    sessionId: "prev2",
    blockId: "b4",
    paymentDatetime: new Date(Date.now() - 1 * 3600000),
    businessDate: new Date().toISOString().split("T")[0],
    subtotalAmount: 2300,
    discountAmount: 500,
    taxAmount: 180,
    totalAmount: 1980,
    cashAmount: 0,
    cashlessAmount: 1980,
    guestCount: 1,
    paidItemIds: [],
    couponId: "c1",
  },
]

export const initialSettings: BusinessSettings = {
  storeName: "ゆとり",
  businessDayStartTime: "18:00",
  taxRate: 10,
  checkedOutDisplaySeconds: 10,
}

export function getBusinessDate(date: Date, startTime: string): string {
  const [startHour, startMin] = startTime.split(":").map(Number)
  const d = new Date(date)
  const currentMinutes = d.getHours() * 60 + d.getMinutes()
  const startMinutes = startHour * 60 + startMin
  if (currentMinutes < startMinutes) {
    d.setDate(d.getDate() - 1)
  }
  return d.toISOString().split("T")[0]
}

export function formatElapsed(from: Date, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - from.getTime()) / 60000)
  if (minutes < 60) return `${minutes}分`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}時間${m > 0 ? `${m}分` : ""}`
}
