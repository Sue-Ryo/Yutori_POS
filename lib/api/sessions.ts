import { supabase } from "@/lib/supabase"
import type { BlockSession, OrderItem } from "@/lib/pos-types"

export function rowToSession(row: Record<string, unknown>): BlockSession {
  const rawItems = ((row.order_items as Record<string, unknown>[]) ?? [])
  const orderItems: OrderItem[] = rawItems.map((item) => ({
    ...(item as object),
    orderedAt: new Date(item.orderedAt as string),
    servedAt: item.servedAt ? new Date(item.servedAt as string) : undefined,
    paidAt: item.paidAt ? new Date(item.paidAt as string) : undefined,
  } as OrderItem))

  return {
    id: row.id as string,
    blockId: row.block_id as string,
    linkedBlockIds: (row.linked_block_ids as string[] | null) ?? undefined,
    orderItems,
    startedAt: new Date(row.started_at as string),
    endedAt: row.ended_at ? new Date(row.ended_at as string) : undefined,
    guestCount: row.guest_count as number,
    note: (row.note as string | null) ?? undefined,
  }
}

function sessionToRow(session: BlockSession): Record<string, unknown> {
  return {
    id: session.id,
    block_id: session.blockId,
    linked_block_ids: session.linkedBlockIds ?? null,
    order_items: session.orderItems.map((item) => ({
      ...item,
      orderedAt: item.orderedAt.toISOString(),
      servedAt: item.servedAt?.toISOString() ?? null,
      paidAt: item.paidAt?.toISOString() ?? null,
    })),
    started_at: session.startedAt.toISOString(),
    ended_at: session.endedAt?.toISOString() ?? null,
    guest_count: session.guestCount,
    note: session.note ?? null,
  }
}

export async function fetchSessions(): Promise<BlockSession[]> {
  const { data, error } = await supabase.from("sessions").select("*")
  if (error) throw error
  return (data as Record<string, unknown>[]).map(rowToSession)
}

export async function upsertSession(session: BlockSession): Promise<void> {
  const { error } = await supabase.from("sessions").upsert(sessionToRow(session))
  if (error) throw error
}
