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

// 全置換（レイアウト保存時に使用）
export async function upsertLayoutElements(elements: LayoutElement[]): Promise<void> {
  const newIds = elements.map((e) => e.id)

  const { data: existing } = await supabase.from("layout_elements").select("id")
  const existingIds = ((existing ?? []) as { id: string }[]).map((r) => r.id)
  const toDelete = existingIds.filter((id) => !newIds.includes(id))

  await Promise.all([
    toDelete.length > 0
      ? supabase.from("layout_elements").delete().in("id", toDelete).then(({ error }) => { if (error) throw error })
      : Promise.resolve(),
    elements.length > 0
      ? supabase.from("layout_elements").upsert(elements.map(elementToRow)).then(({ error }) => { if (error) throw error })
      : Promise.resolve(),
  ])
}
