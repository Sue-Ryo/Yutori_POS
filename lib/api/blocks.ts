import { supabase } from "@/lib/supabase"
import type { ServiceBlock } from "@/lib/pos-types"

export function rowToBlock(row: Record<string, unknown>): ServiceBlock {
  return {
    id: row.id as string,
    name: row.name as string,
    blockType: row.block_type as ServiceBlock["blockType"],
    x: row.x as number,
    y: row.y as number,
    width: row.width as number,
    height: row.height as number,
    rotation: row.rotation as number,
    status: row.status as ServiceBlock["status"],
    capacity: row.capacity as number,
    startedAt: row.started_at ? new Date(row.started_at as string) : undefined,
    checkedOutAt: row.checked_out_at ? new Date(row.checked_out_at as string) : undefined,
  }
}

function blockToRow(block: ServiceBlock): Record<string, unknown> {
  return {
    id: block.id,
    name: block.name,
    block_type: block.blockType,
    x: block.x,
    y: block.y,
    width: block.width,
    height: block.height,
    rotation: block.rotation,
    status: block.status,
    capacity: block.capacity,
    started_at: block.startedAt?.toISOString() ?? null,
    checked_out_at: block.checkedOutAt?.toISOString() ?? null,
  }
}

export async function fetchBlocks(): Promise<ServiceBlock[]> {
  const { data, error } = await supabase.from("blocks").select("*")
  if (error) throw error
  return (data as Record<string, unknown>[]).map(rowToBlock)
}

export async function upsertBlock(block: ServiceBlock): Promise<void> {
  const { error } = await supabase.from("blocks").upsert(blockToRow(block))
  if (error) throw error
}

export async function upsertBlocks(blocks: ServiceBlock[]): Promise<void> {
  if (blocks.length === 0) return
  const { error } = await supabase.from("blocks").upsert(blocks.map(blockToRow))
  if (error) throw error
}
