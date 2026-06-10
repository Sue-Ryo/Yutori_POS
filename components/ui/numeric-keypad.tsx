"use client"

import { useState, useEffect } from "react"
import { Delete } from "lucide-react"
import { Sheet, SheetContent } from "./sheet"
import { Button } from "./button"

interface NumericKeypadSheetProps {
  open: boolean
  label?: string
  initialValue: number
  onConfirm: (value: number) => void
  onClose: () => void
}

export function NumericKeypadSheet({
  open,
  label,
  initialValue,
  onConfirm,
  onClose,
}: NumericKeypadSheetProps) {
  const [input, setInput] = useState("")

  useEffect(() => {
    if (open) {
      setInput(initialValue > 0 ? String(initialValue) : "")
    }
  }, [open, initialValue])

  const handleDigit = (d: string) => {
    setInput((prev) => (prev.length >= 8 ? prev : prev + d))
  }

  const handleBackspace = () => {
    setInput((prev) => prev.slice(0, -1))
  }

  const handleClear = () => setInput("")

  const handleConfirm = () => {
    onConfirm(Number(input) || 0)
    onClose()
  }

  const displayValue = input === "" ? "0" : Number(input).toLocaleString()

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="px-4 pb-8 pt-4">
        {label && (
          <p className="mb-2 text-center text-sm text-muted-foreground">{label}</p>
        )}
        <div className="mb-4 rounded-lg bg-muted px-4 py-3 text-right font-mono text-3xl font-bold">
          {displayValue}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {["7", "8", "9", "4", "5", "6", "1", "2", "3"].map((d) => (
            <Button
              key={d}
              variant="outline"
              className="h-14 text-xl"
              onClick={() => handleDigit(d)}
            >
              {d}
            </Button>
          ))}
          <Button
            variant="destructive"
            className="h-14 text-base"
            onClick={handleClear}
          >
            C
          </Button>
          <Button
            variant="outline"
            className="h-14 text-xl"
            onClick={() => handleDigit("0")}
          >
            0
          </Button>
          <Button
            variant="outline"
            className="h-14"
            onClick={handleBackspace}
          >
            <Delete className="h-5 w-5" />
          </Button>
        </div>
        <Button
          className="mt-3 h-14 w-full text-lg font-bold"
          onClick={handleConfirm}
        >
          確定
        </Button>
      </SheetContent>
    </Sheet>
  )
}
