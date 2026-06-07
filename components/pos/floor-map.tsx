"use client"

import { useState, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import type { ServiceBlock, BlockSession, LayoutElement } from "@/lib/pos-types"
import { formatElapsed } from "@/lib/pos-store"
import { Clock, Link2, CheckCircle2 } from "lucide-react"

interface FloorMapProps {
  blocks: ServiceBlock[]
  sessions: BlockSession[]
  layoutElements: LayoutElement[]
  selectedBlockId: string | null
  onBlockClick: (blockId: string) => void
  isEditorMode?: boolean
  linkMode: boolean
  linkSelection: string[]
  onEnterLinkMode: () => void
  onToggleLinkSelection: (blockId: string) => void
  onConfirmLink: () => void
  onCancelLinkMode: () => void
  moveMode: boolean
  moveSource: string | null
  moveDest: string | null
  onEnterMoveMode: () => void
  onMoveBlockSelect: (blockId: string) => void
  onConfirmMove: () => void
  onCancelMoveMode: () => void
  onDoubleTapBussing: (blockId: string) => void
}

const statusColors: Record<string, string> = {
  empty: "bg-table-empty hover:bg-table-empty/80",
  reserved: "bg-table-reserved hover:bg-table-reserved/80",
  occupied: "bg-table-occupied hover:bg-table-occupied/80",
  checked_out: "bg-table-checked-out hover:bg-table-checked-out/80",
}

const statusLabels: Record<string, string> = {
  empty: "空席",
  reserved: "予約",
  occupied: "使用中",
  checked_out: "会計済",
}

export function FloorMap({
  blocks,
  sessions,
  layoutElements,
  selectedBlockId,
  onBlockClick,
  isEditorMode = false,
  linkMode,
  linkSelection,
  onEnterLinkMode,
  onToggleLinkSelection,
  onConfirmLink,
  onCancelLinkMode,
  moveMode,
  moveSource,
  moveDest,
  onEnterMoveMode,
  onMoveBlockSelect,
  onConfirmMove,
  onCancelMoveMode,
  onDoubleTapBussing,
}: FloorMapProps) {
  const [now, setNow] = useState(new Date())
  const lastTapRef = useRef<{ blockId: string; time: number } | null>(null)
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(id)
  }, [])

  // 連結情報を事前計算
  // バッシング完了（empty）まで連結表示を維持する：会計済み(endedAt あり)でもプライマリブロックが checked_out なら連結扱い
  const linkedSecondaryIds = new Set<string>()
  const primaryWithLinkIds = new Set<string>()
  sessions
    .filter((s) => {
      if (!s.linkedBlockIds || s.linkedBlockIds.length === 0) return false
      if (!s.endedAt) return true
      return blocks.find((b) => b.id === s.blockId)?.status === "checked_out"
    })
    .forEach((s) => {
      primaryWithLinkIds.add(s.blockId)
      s.linkedBlockIds!.forEach((id) => linkedSecondaryIds.add(id))
    })

  // 連結モード中に選択不可なブロック（会計済・すでに連結サブ席）
  const isUnselectable = (block: ServiceBlock) =>
    block.status === "checked_out" || linkedSecondaryIds.has(block.id)

  // 席移動モード中の選択可否
  const isMoveUnselectable = (block: ServiceBlock): boolean => {
    if (moveSource === null) {
      // ステップ1: 移動元 → 使用中かつ連結なしのみ
      return (
        block.status === "empty" ||
        block.status === "checked_out" ||
        linkedSecondaryIds.has(block.id) ||
        primaryWithLinkIds.has(block.id)
      )
    }
    // ステップ2: 移動先 → 空席のみ（移動元自身を除く）
    return block.status !== "empty" || block.id === moveSource
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card">
      {/* ── マップキャンバス ── */}
      <div className="flex-1 overflow-auto">
      <div className="relative p-4" style={{ minHeight: "100%" }}>
      {/* Grid background */}
      <div
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: `
            linear-gradient(to right, currentColor 1px, transparent 1px),
            linear-gradient(to bottom, currentColor 1px, transparent 1px)
          `,
          backgroundSize: "40px 40px",
        }}
      />

      {/* Layout elements */}
      {layoutElements.map((element) => (
        <div
          key={element.id}
          className={cn(
            "absolute flex items-center justify-center rounded text-xs font-medium transition-all",
            element.type === "counter" && "bg-secondary text-secondary-foreground",
            element.type === "wall" && "bg-muted-foreground/30"
          )}
          style={{
            left: element.x,
            top: element.y,
            width: element.width,
            height: element.height,
            transform: `rotate(${element.rotation}deg)`,
          }}
        >
          {element.label && <span>{element.label}</span>}
        </div>
      ))}

      {/* Blocks */}
      {blocks.map((block) => {
        const isSelected = selectedBlockId === block.id
        const isLinkedSecondary = linkedSecondaryIds.has(block.id)
        const isLinkedPrimary = primaryWithLinkIds.has(block.id)
        const isLinkSelected = linkSelection.includes(block.id)
        const linkUnselectable = linkMode && isUnselectable(block)
        const moveUnselectable = moveMode && isMoveUnselectable(block)
        const isMoveSource = moveMode && block.id === moveSource
        const isMoveDest = moveMode && block.id === moveDest

        const handleClick = linkMode
          ? () => { if (!linkUnselectable) onToggleLinkSelection(block.id) }
          : moveMode
            ? () => { if (!moveUnselectable) onMoveBlockSelect(block.id) }
            : () => {
                if (block.status === "checked_out") {
                  const tapTime = Date.now()
                  const last = lastTapRef.current
                  if (last && last.blockId === block.id && tapTime - last.time < 300) {
                    // ダブルタップ：タイマーをキャンセルしてバッシング実行
                    if (singleTapTimerRef.current) {
                      clearTimeout(singleTapTimerRef.current)
                      singleTapTimerRef.current = null
                    }
                    lastTapRef.current = null
                    onDoubleTapBussing(block.id)
                    return
                  }
                  // 1回目タップ：タイマーで待ち、2回目が来なければサイドバーを開く
                  lastTapRef.current = { blockId: block.id, time: tapTime }
                  singleTapTimerRef.current = setTimeout(() => {
                    singleTapTimerRef.current = null
                    lastTapRef.current = null
                    onBlockClick(block.id)
                  }, 300)
                  return
                }
                onBlockClick(block.id)
              }

        return (
          <button
            key={block.id}
            onClick={handleClick}
            disabled={linkUnselectable || moveUnselectable}
            className={cn(
              "absolute flex flex-col items-center justify-center rounded-lg border-2 text-foreground shadow-lg transition-all",
              statusColors[block.status],
              // 通常モード
              !linkMode && !moveMode && isSelected && "border-primary ring-2 ring-primary/50",
              !linkMode && !moveMode && !isSelected && isLinkedSecondary && "border-info ring-2 ring-info/30",
              !linkMode && !moveMode && !isSelected && !isLinkedSecondary && "border-transparent",
              !linkMode && !moveMode && "hover:scale-105 active:scale-95",
              // 連結モード
              linkMode && !linkUnselectable && "cursor-pointer hover:scale-105 active:scale-95",
              linkMode && isLinkSelected && "border-success ring-2 ring-success/60 scale-105",
              linkMode && !isLinkSelected && !linkUnselectable && "border-dashed border-muted-foreground/50 hover:border-success",
              linkMode && linkUnselectable && "cursor-not-allowed opacity-40",
              // 席移動モード
              moveMode && !moveUnselectable && "cursor-pointer hover:scale-105 active:scale-95",
              moveMode && moveUnselectable && "cursor-not-allowed opacity-40",
              isMoveSource && "border-amber-500 ring-2 ring-amber-400/60 scale-105",
              isMoveDest && "border-teal-500 ring-2 ring-teal-400/60 scale-105",
              moveMode && !isMoveSource && !isMoveDest && !moveUnselectable && "border-dashed border-muted-foreground/50",
            )}
            style={{
              left: block.x,
              top: block.y,
              width: block.width,
              height: block.height,
              transform: `rotate(${block.rotation}deg)`,
            }}
          >
            {/* 連結モード: 選択済みチェック */}
            {linkMode && isLinkSelected && (
              <CheckCircle2 className="absolute right-1 top-1 h-3.5 w-3.5 text-success" />
            )}
            {/* 席移動モード: 移動元/移動先ラベル */}
            {isMoveSource && (
              <span className="absolute right-1 top-1 text-[9px] font-bold text-amber-500">移動元</span>
            )}
            {isMoveDest && (
              <span className="absolute right-1 top-1 text-[9px] font-bold text-teal-500">移動先</span>
            )}
            {/* 通常モード: 連結アイコン */}
            {!linkMode && !moveMode && (isLinkedPrimary || isLinkedSecondary) && (
              <Link2 className="absolute right-1 top-1 h-3 w-3 opacity-60" />
            )}
            <span className="text-sm font-bold leading-tight">{block.name}</span>
            <span className="mt-0.5 text-[10px] uppercase tracking-wide opacity-80">
              {isLinkedSecondary ? "連結中" : statusLabels[block.status]}
            </span>
            {block.startedAt && (block.status === "occupied" || block.status === "checked_out") && (
              <div className="mt-1 flex items-center gap-1 text-[10px] opacity-80">
                <Clock className="h-2.5 w-2.5" />
                <span>{formatElapsed(block.startedAt, now)}</span>
              </div>
            )}
          </button>
        )
      })}

      </div>
      </div>
    </div>
  )
}
