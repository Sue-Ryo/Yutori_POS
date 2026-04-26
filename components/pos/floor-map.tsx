"use client"

import { useState, useEffect } from "react"
import { cn } from "@/lib/utils"
import type { ServiceBlock, BlockSession, LayoutElement } from "@/lib/pos-types"
import { formatElapsed } from "@/lib/pos-store"
import { Clock, Timer, Link2, CheckCircle2 } from "lucide-react"
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
}

const statusColors: Record<string, string> = {
  empty: "bg-table-empty hover:bg-table-empty/80",
  occupied: "bg-table-occupied hover:bg-table-occupied/80",
  waiting: "bg-table-waiting hover:bg-table-waiting/80",
  checked_out: "bg-table-checked-out hover:bg-table-checked-out/80",
}

const statusLabels: Record<string, string> = {
  empty: "空席",
  occupied: "使用中",
  waiting: "提供待ち",
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
}: FloorMapProps) {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(id)
  }, [])

  const getSession = (blockId: string) => sessions.find((s) => s.blockId === blockId)

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

  const getServingElapsed = (session: BlockSession | undefined): string | null => {
    if (!session) return null
    const servedItems = session.orderItems.filter((i) => i.servedAt)
    if (servedItems.length === 0) return null
    const earliest = servedItems.reduce((min, i) =>
      i.servedAt!.getTime() < min.servedAt!.getTime() ? i : min
    )
    return formatElapsed(earliest.servedAt!, now)
  }

  return (
    <div className="relative h-full w-full overflow-auto rounded-lg border border-border bg-card p-4">
      {/* 凡例 */}
      <div className="absolute right-4 top-4 flex gap-3 rounded-md bg-muted/50 px-3 py-2 text-xs z-10">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded bg-table-empty" />
          <span className="text-muted-foreground">空席</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded bg-table-occupied" />
          <span className="text-muted-foreground">使用中</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded bg-table-waiting" />
          <span className="text-muted-foreground">提供待ち</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded bg-table-checked-out" />
          <span className="text-muted-foreground">会計済</span>
        </div>
        <div className="flex items-center gap-2">
          <Link2 className="h-3 w-3 text-info" />
          <span className="text-muted-foreground">連結中</span>
        </div>
      </div>

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
        const session = getSession(block.id)
        const servingElapsed = getServingElapsed(session)
        const isLinkedSecondary = linkedSecondaryIds.has(block.id)
        const isLinkedPrimary = primaryWithLinkIds.has(block.id)
        const isLinkSelected = linkSelection.includes(block.id)
        const unselectable = linkMode && isUnselectable(block)

        const handleClick = linkMode
          ? () => { if (!unselectable) onToggleLinkSelection(block.id) }
          : () => onBlockClick(block.id)

        return (
          <button
            key={block.id}
            onClick={handleClick}
            disabled={unselectable}
            className={cn(
              "absolute flex flex-col items-center justify-center rounded-lg border-2 text-foreground shadow-lg transition-all",
              statusColors[block.status],
              // 通常モードの選択・連結表示
              !linkMode && isSelected && "border-primary ring-2 ring-primary/50",
              !linkMode && !isSelected && isLinkedSecondary && "border-info ring-2 ring-info/30",
              !linkMode && !isSelected && !isLinkedSecondary && "border-transparent",
              // 連結モード
              linkMode && !unselectable && "cursor-pointer hover:scale-105 active:scale-95",
              linkMode && isLinkSelected && "border-success ring-2 ring-success/60 scale-105",
              linkMode && !isLinkSelected && !unselectable && "border-dashed border-muted-foreground/50 hover:border-success",
              linkMode && unselectable && "cursor-not-allowed opacity-40",
              !linkMode && "hover:scale-105 active:scale-95",
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
            {/* 通常モード: 連結アイコン */}
            {!linkMode && (isLinkedPrimary || isLinkedSecondary) && (
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
            {servingElapsed && !isLinkedSecondary && (
              <div className="flex items-center gap-1 text-[10px] opacity-80">
                <Timer className="h-2.5 w-2.5" />
                <span>{servingElapsed}</span>
              </div>
            )}
          </button>
        )
      })}

      {linkMode ? (
        <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded-lg border border-info/50 bg-card/95 px-3 py-2 shadow-md">
          <Link2 className="h-4 w-4 text-info" />
          <span className="text-sm font-medium text-info">連結する席を選択</span>
          <span className="text-xs text-muted-foreground">{linkSelection.length}席選択中</span>
          <Button
            size="sm"
            className="ml-1 bg-success text-primary-foreground hover:bg-success/90"
            disabled={linkSelection.length < 2}
            onClick={onConfirmLink}
          >
            連結する
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancelLinkMode}>
            キャンセル
          </Button>
        </div>
      ) : (
        <div className="absolute bottom-4 left-4 flex items-center gap-3">
          <span className="text-xs text-muted-foreground">タップでブロック操作</span>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={onEnterLinkMode}>
            <Link2 className="h-3.5 w-3.5" />
            席を連結
          </Button>
        </div>
      )}
    </div>
  )
}
