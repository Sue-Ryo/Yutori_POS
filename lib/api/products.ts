import { supabase } from "@/lib/supabase"
import type { Product } from "@/lib/pos-types"

export async function fetchProducts(storeId: number): Promise<Product[]> {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("store_id", storeId)
    .order("display_order", { ascending: true })
    .range(0, 999)

  if (error) {
    console.error("[fetchProducts] Supabase error:", error)
    throw error
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data.map((row: any) => ({
    id: String(row.id),
    category: row.category ?? String(row.category_id ?? ""),
    name: row.item_name ?? row.name ?? "",
    price: row.price_yen ?? row.price ?? 0,
    isActive: row.is_active ?? true,
    displayOrder: row.display_order ?? 0,
  }))
}

export async function createProduct(product: Omit<Product, "id">, storeId: number): Promise<Product> {
  const { data, error } = await supabase
    .from("products")
    .insert({
      category: product.category,
      item_name: product.name,
      price_yen: product.price,
      is_active: product.isActive,
      display_order: product.displayOrder,
      store_id: storeId,
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

export async function updateProduct(id: string, updates: Partial<Omit<Product, "id">>): Promise<void> {
  const dbUpdates: Record<string, unknown> = {}
  if (updates.category !== undefined) dbUpdates.category = updates.category
  if (updates.name !== undefined) dbUpdates.item_name = updates.name
  if (updates.price !== undefined) dbUpdates.price_yen = updates.price
  if (updates.isActive !== undefined) dbUpdates.is_active = updates.isActive
  if (updates.displayOrder !== undefined) dbUpdates.display_order = updates.displayOrder

  const { error } = await supabase.from("products").update(dbUpdates).eq("id", Number(id))
  if (error) throw error
}

export async function deleteProduct(id: string): Promise<void> {
  const { error } = await supabase.from("products").delete().eq("id", Number(id))
  if (error) throw error
}
