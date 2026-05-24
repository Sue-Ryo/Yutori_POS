import { supabase } from "@/lib/supabase"
import type { DailyExpense } from "@/lib/pos-types"

function rowToExpense(row: Record<string, unknown>): DailyExpense {
  return {
    businessDate: row.business_date as string,
    receiptCount: row.receipt_count as number,
    amount: row.amount as number,
    updatedAt: new Date(row.updated_at as string),
    handoverNote: (row.handover_note as string) ?? "",
  }
}

export async function fetchExpenses(): Promise<DailyExpense[]> {
  const { data, error } = await supabase
    .from("daily_expenses")
    .select("*")
    .order("business_date", { ascending: false })
  if (error) throw error
  return (data as Record<string, unknown>[]).map(rowToExpense)
}

export async function upsertExpense(expense: DailyExpense): Promise<void> {
  const { error } = await supabase
    .from("daily_expenses")
    .upsert({
      business_date: expense.businessDate,
      receipt_count: expense.receiptCount,
      amount: expense.amount,
      handover_note: expense.handoverNote,
      updated_at: new Date().toISOString(),
    })
  if (error) throw error
}
