"use client"

import { useState, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import type { ServiceBlock, BlockSession, LayoutElement } from "@/lib/pos-types"
import { formatElapsed } from "@/lib/pos-store"
import { Clock, Link2, CheckCircle2, ArrowRightLeft } from "lucide-react"
import { Button } from "@/components/ui/button"

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
  const linkedSecondaryIds = new Set<string>()
  const primaryWithLinkIds = new Set<string>()
  sessions
    .filter((s) => !s.endedAt && s.linkedBlockIds && s.linkedBlockIds.length > 0)
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
      {/* ── ヘッダーバー ── */}
      {linkMode ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <Link2 className="h-4 w-4 text-info" />
          <span className="text-sm font-medium text-info">連結する席を選択</span>
          <span className="text-xs text-muted-foreground">{linkSelection.length}席選択中</span>
          <Button size="sm" className="ml-1 bg-success text-primary-foreground hover:bg-success/90" disabled={linkSelection.length < 2} onClick={onConfirmLink}>連結する</Button>
          <Button size="sm" variant="ghost" onClick={onCancelLinkMode}>キャンセル</Button>
        </div>
      ) : moveMode ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <ArrowRightLeft className="h-4 w-4 text-amber-500" />
          <span className="text-sm font-medium text-amber-600">
            {moveSource === null ? "移動元の席をタップ" : "移動先の空席をタップ"}
          </span>
          {moveSource && moveDest && (
            <Button size="sm" className="ml-1 bg-success text-primary-foreground hover:bg-success/90" onClick={onConfirmMove}>移動する</Button>
          )}
          <Button size="sm" variant="ghost" onClick={onCancelMoveMode}>キャンセル</Button>
        </div>
      ) : (
        <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
          {/* 凡例 */}
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded bg-table-empty" />
              <span className="text-muted-foreground">空席</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded bg-table-reserved" />
              <span className="text-muted-foreground">予約</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded bg-table-occupied" />
              <span className="text-muted-foreground">使用中</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded bg-table-checked-out" />
              <span className="text-muted-foreground">会計済</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Link2 className="h-3 w-3 text-info" />
              <span className="text-muted-foreground">連結中</span>
            </div>
          </div>
          {/* 操作ボタン */}
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={onEnterLinkMode}>
              <Link2 className="h-3.5 w-3.5" />
              席を連結
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={onEnterMoveMode}>
              <ArrowRightLeft className="h-3.5 w-3.5" />
              席移動
            </Button>
          </div>
        </div>
      )}

      {/* ── マップキャンバス ── */}
      <div className="relative flex-1 overflow-auto p-4">
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
            {block.startedAt && block.status !== "empty" && (
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
  )
}
