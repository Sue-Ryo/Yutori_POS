import { supabase } from "@/lib/supabase"
import type { Product } from "@/lib/pos-types"

// ── 商品 ──────────────────────────────────────────────────────────────

export async function fetchProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("display_order", { ascending: true })
    .range(0, 999)

  if (error) {
    console.error("[fetchProducts] Supabase error:", error)
    throw error
  }

  console.log(`[fetchProducts] 取得件数: ${data.length}件`, data[0])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data.map((row: any) => ({
    id: String(row.id),
    // 新スキーマ(category) / 旧スキーマ(category_id) 両対応
    category: row.category ?? String(row.category_id ?? ""),
    // 新スキーマ(item_name) / 旧スキーマ(name) 両対応
    name: row.item_name ?? row.name ?? "",
    // 新スキーマ(price_yen) / 旧スキーマ(price) 両対応
    price: row.price_yen ?? row.price ?? 0,
    isActive: row.is_active ?? true,
    displayOrder: row.display_order ?? 0,
  }))
}

export async function createProduct(
  product: Omit<Product, "id">,
): Promise<Product> {
  const { data, error } = await supabase
    .from("products")
    .insert({
      category: product.category,
      item_name: product.name,
      price_yen: product.price,
      is_active: product.isActive,
      display_order: product.displayOrder,
    })
    .select()
    .single()

  if (error) throw error

  return {
    id: String(data.id),
    category: data.category ?? "",
    name: data.item_name,
    price: data.price_yen,
    isActive: data.is_active,
    displayOrder: data.display_order,
  }
}

export async function updateProduct(
  id: string,
  updates: Partial<Omit<Product, "id">>,
): Promise<void> {
  const dbUpdates: Record<string, unknown> = {}
  if (updates.category !== undefined) dbUpdates.category = updates.category
  if (updates.name !== undefined) dbUpdates.item_name = updates.name
  if (updates.price !== undefined) dbUpdates.price_yen = updates.price
  if (updates.isActive !== undefined) dbUpdates.is_active = updates.isActive
  if (updates.displayOrder !== undefined) dbUpdates.display_order = updates.displayOrder

  const { error } = await supabase
    .from("products")
    .update(dbUpdates)
    .eq("id", Number(id))
  if (error) throw error
}

export async function deleteProduct(id: string): Promise<void> {
  const { error } = await supabase
    .from("products")
    .delete()
    .eq("id", Number(id))
  if (error) throw error
}
