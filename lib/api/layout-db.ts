import { supabase } from "@/lib/supabase"
import type { LayoutElement } from "@/lib/pos-types"

function rowToElement(row: Record<string, unknown>): LayoutElement {
  return {
    id: row.id as string,
    type: row.type as LayoutElement["type"],
    x: row.x as number,
    y: row.y as number,
    width: row.width as number,
    height: row.height as number,
    rotation: row.rotation as number,
    label: (row.label as string | null) ?? undefined,
  }
}

function elementToRow(el: LayoutElement): Record<string, unknown> {
  return {
    id: el.id,
    type: el.type,
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    rotation: el.rotation,
    label: el.label ?? null,
  }
}

export async function fetchLayoutElements(): Promise<LayoutElement[]> {
  const { data, error } = await supabase.from("layout_elements").select("*")
  if (error) throw error
  return (data as Record<string, unknown>[]).map(rowToElement)
}

export async function upsertLayoutElements(elements: LayoutElement[]): Promise<void> {
  // 全件削除 → 全件挿入（シンプルな全置換）
  await supabase.from("layout_elements").delete().neq("id", "")
  if (elements.length === 0) return
  const { error } = await supabase.from("layout_elements").insert(elements.map(elementToRow))
  if (error) throw error
}
