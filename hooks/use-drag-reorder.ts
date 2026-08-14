"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from "react"

/** 長押しと判定するまでの時間 */
const LONG_PRESS_MS = 350
/** この距離動いたらスクロール操作とみなして長押しを取り消す */
const MOVE_CANCEL_PX = 8

type DragState = {
  /** 並び替え対象のグループ（カテゴリ名など）。同じフックで複数リストを扱う */
  groupKey: string
  id: string
  order: string[]
}

/**
 * 長押ししてそのままスライドで並び替えるフック（タッチ・マウス共通）。
 *
 * - 長押し前に指が動いたらスクロールとして扱い、並び替えを始めない
 * - 並び替え中はページのスクロールを止める（touchmove を非パッシブで抑止）
 * - 要素の中央を跨いだ時点で入れ替えるので、指を離す前に結果が見える
 *
 * groupKey ごとに独立した並びを扱えるため、カテゴリの並び替えと
 * カテゴリ内の商品の並び替えを1つのフックで扱える。
 */
export function useDragReorder(onCommit: (groupKey: string, orderedIds: string[]) => void) {
  const [drag, setDrag] = useState<DragState | null>(null)

  const dragRef = useRef<DragState | null>(null)
  const elements = useRef(new Map<string, HTMLElement>())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startY = useRef(0)
  const initialOrder = useRef<string[]>([])
  const onCommitRef = useRef(onCommit)
  useEffect(() => {
    onCommitRef.current = onCommit
  })

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }

  // 並び替え中だけスクロールを止める。React の onTouchMove はパッシブで
  // preventDefault が効かないため、ネイティブに非パッシブで登録する
  useEffect(() => {
    if (!drag) return
    const block = (e: TouchEvent) => e.preventDefault()
    document.addEventListener("touchmove", block, { passive: false })
    return () => document.removeEventListener("touchmove", block)
  }, [drag])

  useEffect(() => () => clearTimer(), [])

  const setDragState = (next: DragState | null) => {
    dragRef.current = next
    setDrag(next)
  }

  const endDrag = useCallback(() => {
    clearTimer()
    const current = dragRef.current
    setDragState(null)
    if (!current) return
    const before = initialOrder.current
    const changed =
      current.order.length !== before.length ||
      current.order.some((id, i) => id !== before[i])
    if (changed) onCommitRef.current(current.groupKey, current.order)
  }, [])

  /** 指の位置から、掴んでいる要素の新しい位置を求めて並びを更新する */
  const updatePosition = (clientY: number) => {
    const current = dragRef.current
    if (!current) return
    const fromIndex = current.order.indexOf(current.id)
    if (fromIndex < 0) return

    let toIndex = fromIndex
    current.order.forEach((id, i) => {
      if (id === current.id) return
      const rect = elements.current.get(id)?.getBoundingClientRect()
      if (!rect) return
      const middle = rect.top + rect.height / 2
      if (i < fromIndex && clientY < middle) toIndex = Math.min(toIndex, i)
      if (i > fromIndex && clientY > middle) toIndex = Math.max(toIndex, i)
    })
    if (toIndex === fromIndex) return

    const next = [...current.order]
    next.splice(toIndex, 0, ...next.splice(fromIndex, 1))
    setDragState({ ...current, order: next })
  }

  const getItemProps = useCallback((groupKey: string, ids: string[], id: string) => ({
    ref: (el: HTMLElement | null) => {
      if (el) elements.current.set(id, el)
      else elements.current.delete(id)
    },
    onPointerDown: (e: ReactPointerEvent) => {
      // 主ボタン以外・並び替え中は無視
      if (e.button !== 0 || dragRef.current) return
      // ボタンや入力欄の長押しで並び替えを始めない
      if ((e.target as HTMLElement).closest("button, input, select, textarea")) return
      // 入れ子（カテゴリの中の商品）では内側が優先。外側へは伝えない
      e.stopPropagation()
      startY.current = e.clientY
      const target = e.currentTarget as HTMLElement
      clearTimer()
      timer.current = setTimeout(() => {
        // 指を離しても座標を受け取り続けるため、掴んだ要素に固定する
        try {
          target.setPointerCapture(e.pointerId)
        } catch {
          // 対応していない環境ではキャプチャなしで続行する
        }
        initialOrder.current = ids
        setDragState({ groupKey, id, order: ids })
      }, LONG_PRESS_MS)
    },
    onPointerMove: (e: ReactPointerEvent) => {
      if (!dragRef.current) {
        // まだ長押し待ち。動いたらスクロールとして扱う
        if (Math.abs(e.clientY - startY.current) > MOVE_CANCEL_PX) clearTimer()
        return
      }
      if (dragRef.current.groupKey !== groupKey) return
      updatePosition(e.clientY)
    },
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    // 長押しでiOSの選択メニューが出ないようにする
    onContextMenu: (e: ReactMouseEvent) => {
      if (dragRef.current) e.preventDefault()
    },
    style: {
      touchAction: drag ? ("none" as const) : undefined,
      WebkitTouchCallout: "none" as const,
    },
  }), [drag, endDrag])

  return {
    /** 並び替え中はプレビューの並び、そうでなければ渡された並びを返す */
    orderOf: (groupKey: string, ids: string[]) =>
      drag?.groupKey === groupKey ? drag.order : ids,
    /** 掴んでいる項目のID（見た目を変えるため） */
    draggingId: drag?.id ?? null,
    getItemProps,
  }
}
