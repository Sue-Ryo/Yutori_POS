"use client"

import { useState, useRef, useEffect } from "react"
import { cn } from "@/lib/utils"
import type { ServiceBlock, LayoutElement, BlockType } from "@/lib/pos-types"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  RectangleHorizontal,
  Minus,
  RotateCw,
  Trash2,
  Save,
  GripVertical,
  Armchair,
  Sofa,
  DoorOpen,
} from "lucide-react"

const GRID = 10

function snap(v: number) {
  return Math.round(v / GRID) * GRID
}

const blockTypeLabels: Record<BlockType, string> = {
  chair: "椅子席",
  sofa: "ソファ席",
  counter: "カウンター席",
  private_room: "個室",
  wall: "壁",
  counter_equipment: "カウンター設備",
  passage: "通路",
}

const seatBlockTypes: BlockType[] = ["chair", "sofa", "counter", "private_room"]

interface LayoutEditorProps {
  blocks: ServiceBlock[]
  layoutElements: LayoutElement[]
  onSaveLayout: (blocks: ServiceBlock[], elements: LayoutElement[]) => void
}

type SelectedItem = { id: string; kind: "block" | "element" }

export function LayoutEditor({
  blocks: initialBlocks,
  layoutElements: initialElements,
  onSaveLayout,
}: LayoutEditorProps) {
  const [blocks, setBlocks] = useState<ServiceBlock[]>(initialBlocks)
  const [elements, setElements] = useState<LayoutElement[]>(initialElements)
  const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const canvasRef = useRef<HTMLDivElement>(null)

  // Delete / Escape キー
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return
      if ((e.target as HTMLElement).tagName === "SELECT") return
      if ((e.key === "Delete" || e.key === "Backspace") && selectedItem) {
        handleDelete()
      }
      if (e.key === "Escape") setSelectedItem(null)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItem])

  const handleAddBlock = (blockType: BlockType) => {
    const isWide = blockType === "sofa" || blockType === "private_room"
    const newBlock: ServiceBlock = {
      id: `b-${Date.now()}`,
      name: blockTypeLabels[blockType],
      blockType,
      x: snap(80),
      y: snap(80),
      width: isWide ? 120 : 70,
      height: isWide ? 80 : 70,
      rotation: 0,
      status: "empty",
      capacity: blockType === "private_room" ? 6 : blockType === "sofa" ? 4 : 1,
    }
    setBlocks((prev) => [...prev, newBlock])
    setSelectedItem({ id: newBlock.id, kind: "block" })
  }

  const handleAddElement = (type: "counter" | "wall") => {
    const newEl: LayoutElement = {
      id: `e-${Date.now()}`,
      type,
      x: snap(80),
      y: snap(80),
      width: type === "counter" ? 200 : 100,
      height: type === "counter" ? 40 : 15,
      rotation: 0,
      label: type === "counter" ? "カウンター" : undefined,
    }
    setElements((prev) => [...prev, newEl])
    setSelectedItem({ id: newEl.id, kind: "element" })
  }

  const handleMouseDown = (
    e: React.MouseEvent,
    item: SelectedItem,
    itemX: number,
    itemY: number,
  ) => {
    e.stopPropagation()
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    setDragOffset({
      x: e.clientX - rect.left - itemX,
      y: e.clientY - rect.top - itemY,
    })
    setSelectedItem(item)
    setIsDragging(true)
    e.preventDefault()
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !selectedItem) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const newX = snap(Math.max(0, e.clientX - rect.left - dragOffset.x))
    const newY = snap(Math.max(0, e.clientY - rect.top - dragOffset.y))

    if (selectedItem.kind === "block") {
      setBlocks((prev) =>
        prev.map((b) => (b.id === selectedItem.id ? { ...b, x: newX, y: newY } : b))
      )
    } else {
      setElements((prev) =>
        prev.map((el) => (el.id === selectedItem.id ? { ...el, x: newX, y: newY } : el))
      )
    }
  }

  const handleMouseUp = () => setIsDragging(false)

  const handleRotate = () => {
    if (!selectedItem) return
    if (selectedItem.kind === "block") {
      setBlocks((prev) =>
        prev.map((b) =>
          b.id === selectedItem.id ? { ...b, rotation: (b.rotation + 90) % 360 } : b
        )
      )
    } else {
      setElements((prev) =>
        prev.map((el) =>
          el.id === selectedItem.id ? { ...el, rotation: (el.rotation + 90) % 360 } : el
        )
      )
    }
  }

  const handleResize = (dim: "width" | "height", delta: number) => {
    if (!selectedItem) return
    if (selectedItem.kind === "block") {
      setBlocks((prev) =>
        prev.map((b) =>
          b.id === selectedItem.id ? { ...b, [dim]: Math.max(40, b[dim] + delta) } : b
        )
      )
    } else {
      setElements((prev) =>
        prev.map((el) =>
          el.id === selectedItem.id ? { ...el, [dim]: Math.max(15, el[dim] + delta) } : el
        )
      )
    }
  }

  const handleDelete = () => {
    if (!selectedItem) return
    if (selectedItem.kind === "block") {
      setBlocks((prev) => prev.filter((b) => b.id !== selectedItem.id))
    } else {
      setElements((prev) => prev.filter((el) => el.id !== selectedItem.id))
    }
    setSelectedItem(null)
  }

  const updateBlock = (id: string, updates: Partial<ServiceBlock>) =>
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...updates } : b)))

  const selectedBlock = selectedItem?.kind === "block"
    ? blocks.find((b) => b.id === selectedItem.id)
    : null
  const selectedElement = selectedItem?.kind === "element"
    ? elements.find((el) => el.id === selectedItem.id)
    : null

  return (
    <div className="flex h-full gap-4">
      {/* Canvas */}
      <div
        ref={canvasRef}
        className={cn(
          "relative flex-1 overflow-auto rounded-lg border border-border bg-card",
          isDragging ? "cursor-grabbing" : "cursor-default",
        )}
        style={{ minHeight: 500 }}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={() => setSelectedItem(null)}
      >
        {/* Grid */}
        <div
          className="pointer-events-none absolute inset-0 opacity-10"
          style={{
            backgroundImage: `
              linear-gradient(to right, currentColor 1px, transparent 1px),
              linear-gradient(to bottom, currentColor 1px, transparent 1px)
            `,
            backgroundSize: `${GRID * 4}px ${GRID * 4}px`,
          }}
        />

        {/* 最低キャンバスサイズ確保用の透明div */}
        <div style={{ width: 800, height: 600 }} className="pointer-events-none" />

        {/* Layout elements */}
        {elements.map((el) => (
          <div
            key={el.id}
            className={cn(
              "absolute flex cursor-grab items-center justify-center rounded text-xs font-medium select-none",
              el.type === "counter" && "bg-secondary text-secondary-foreground",
              el.type === "wall" && "bg-muted-foreground/30",
              selectedItem?.id === el.id && "ring-2 ring-primary ring-offset-card ring-offset-1",
            )}
            style={{
              left: el.x,
              top: el.y,
              width: el.width,
              height: el.height,
              transform: `rotate(${el.rotation}deg)`,
            }}
            onMouseDown={(e) => handleMouseDown(e, { id: el.id, kind: "element" }, el.x, el.y)}
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="absolute left-0.5 h-3 w-3 opacity-30" />
            {el.label && <span className="px-1">{el.label}</span>}
          </div>
        ))}

        {/* Blocks */}
        {blocks.map((block) => (
          <div
            key={block.id}
            className={cn(
              "absolute flex cursor-grab flex-col items-center justify-center rounded-lg border-2 bg-table-empty text-foreground shadow-md select-none",
              selectedItem?.id === block.id
                ? "border-primary ring-2 ring-primary/50"
                : "border-border/40",
            )}
            style={{
              left: block.x,
              top: block.y,
              width: block.width,
              height: block.height,
              transform: `rotate(${block.rotation}deg)`,
            }}
            onMouseDown={(e) =>
              handleMouseDown(e, { id: block.id, kind: "block" }, block.x, block.y)
            }
            onClick={(e) => e.stopPropagation()}
          >
            <span className="px-1 text-center text-xs font-bold leading-tight">
              {block.name}
            </span>
            <span className="text-[10px] opacity-50">{blockTypeLabels[block.blockType]}</span>
            {block.capacity > 1 && (
              <span className="text-[9px] opacity-40">{block.capacity}名</span>
            )}
          </div>
        ))}
      </div>

      {/* Toolbox */}
      <div className="w-60 space-y-3 overflow-y-auto">
        {/* 席ブロック */}
        <Card>
          <CardHeader className="py-2.5">
            <CardTitle className="text-xs font-semibold text-muted-foreground">席ブロック</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 pb-3">
            <Button
              variant="secondary"
              className="w-full justify-start"
              onClick={() => handleAddBlock("chair")}
            >
              <Armchair className="mr-2 h-4 w-4" />
              椅子席
            </Button>
            <Button
              variant="secondary"
              className="w-full justify-start"
              onClick={() => handleAddBlock("sofa")}
            >
              <Sofa className="mr-2 h-4 w-4" />
              ソファ席
            </Button>
            <Button
              variant="secondary"
              className="w-full justify-start"
              onClick={() => handleAddBlock("counter")}
            >
              <RectangleHorizontal className="mr-2 h-4 w-4" />
              カウンター席
            </Button>
            <Button
              variant="secondary"
              className="w-full justify-start"
              onClick={() => handleAddBlock("private_room")}
            >
              <DoorOpen className="mr-2 h-4 w-4" />
              個室
            </Button>
          </CardContent>
        </Card>

        {/* 装飾・設備 */}
        <Card>
          <CardHeader className="py-2.5">
            <CardTitle className="text-xs font-semibold text-muted-foreground">装飾・設備</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 pb-3">
            <Button
              variant="secondary"
              className="w-full justify-start"
              onClick={() => handleAddElement("counter")}
            >
              <RectangleHorizontal className="mr-2 h-4 w-4" />
              カウンター設備
            </Button>
            <Button
              variant="secondary"
              className="w-full justify-start"
              onClick={() => handleAddElement("wall")}
            >
              <Minus className="mr-2 h-4 w-4" />
              壁
            </Button>
          </CardContent>
        </Card>

        {/* 選択中アイテムの編集 */}
        {selectedItem ? (
          <Card className="border-primary/40">
            <CardHeader className="py-2.5">
              <CardTitle className="text-xs font-semibold">
                {selectedBlock ? "席ブロックを編集" : "要素を編集"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pb-3">
              {selectedBlock && (
                <>
                  <div>
                    <Label className="text-xs text-muted-foreground">名前</Label>
                    <Input
                      value={selectedBlock.name}
                      onChange={(e) => updateBlock(selectedBlock.id, { name: e.target.value })}
                      className="mt-1 h-8"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">種別</Label>
                    <select
                      className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                      value={selectedBlock.blockType}
                      onChange={(e) =>
                        updateBlock(selectedBlock.id, { blockType: e.target.value as BlockType })
                      }
                      onClick={(e) => e.stopPropagation()}
                    >
                      {seatBlockTypes.map((t) => (
                        <option key={t} value={t}>
                          {blockTypeLabels[t]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">定員</Label>
                    <Input
                      type="number"
                      min={1}
                      value={selectedBlock.capacity}
                      onChange={(e) =>
                        updateBlock(selectedBlock.id, {
                          capacity: Math.max(1, Number(e.target.value)),
                        })
                      }
                      className="mt-1 h-8"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                </>
              )}
              {selectedElement && (
                <div>
                  <Label className="text-xs text-muted-foreground">ラベル</Label>
                  <Input
                    value={selectedElement.label ?? ""}
                    onChange={(e) =>
                      setElements((prev) =>
                        prev.map((el) =>
                          el.id === selectedElement.id ? { ...el, label: e.target.value } : el,
                        )
                      )
                    }
                    className="mt-1 h-8"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              )}

              {/* サイズ */}
              <div>
                <Label className="text-xs text-muted-foreground">サイズ調整</Label>
                <div className="mt-1 grid grid-cols-2 gap-1">
                  {(
                    [
                      ["幅＋", "width", 10],
                      ["幅－", "width", -10],
                      ["高＋", "height", 10],
                      ["高－", "height", -10],
                    ] as const
                  ).map(([label, dim, delta]) => (
                    <Button
                      key={label}
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleResize(dim, delta)
                      }}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 text-xs"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRotate()
                  }}
                >
                  <RotateCw className="mr-1 h-3 w-3" />
                  90°回転
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete()
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Delete キーで削除 / Esc で選択解除
              </p>
            </CardContent>
          </Card>
        ) : (
          <p className="px-2 text-center text-xs text-muted-foreground">
            要素をクリックして選択
            <br />
            ドラッグで移動（10px スナップ）
          </p>
        )}

        <Button
          className="w-full bg-success text-primary-foreground hover:bg-success/90"
          onClick={() => onSaveLayout(blocks, elements)}
        >
          <Save className="mr-2 h-4 w-4" />
          レイアウトを保存
        </Button>
      </div>
    </div>
  )
}
