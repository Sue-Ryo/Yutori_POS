"use client"

import { useState, useEffect } from "react"
import { hashPin, verifyPin } from "@/lib/pin"
import { fetchStores, updatePinHash, type Store } from "@/lib/api/stores-db"
import { saveSession } from "@/lib/session"
import { Button } from "@/components/ui/button"
import { Delete, Check } from "lucide-react"

type Step = "store" | "pin" | "setup" | "setup-confirm"

interface Props {
  onLogin: (storeId: number, storeName: string) => void
}

export function LoginScreen({ onLogin }: Props) {
  const [stores, setStores] = useState<Store[]>([])
  const [selected, setSelected] = useState<Store | null>(null)
  const [step, setStep] = useState<Step>("store")
  const [pin, setPin] = useState("")
  const [confirmPin, setConfirmPin] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchStores().then(setStores).catch(() => setError("店舗情報の取得に失敗しました"))
  }, [])

  const handleStoreSelect = (store: Store) => {
    setSelected(store)
    setPin("")
    setConfirmPin("")
    setError("")
    setStep(store.pinHash ? "pin" : "setup")
  }

  const currentPin = step === "setup-confirm" ? confirmPin : pin
  const setCurrentPin = step === "setup-confirm" ? setConfirmPin : setPin

  const handleKey = (key: string) => {
    setError("")
    if (key === "del") {
      setCurrentPin((p) => p.slice(0, -1))
      return
    }
    setCurrentPin((p) => (p.length < 6 ? p + key : p))
  }

  const handleConfirm = async () => {
    if (!selected) return
    if (currentPin.length < 4) {
      setError("4桁以上入力してください")
      return
    }

    if (step === "pin") {
      setLoading(true)
      try {
        const ok = await verifyPin(pin, selected.pinHash)
        if (!ok) {
          setError("PINが違います")
          setPin("")
        } else {
          saveSession({ storeId: selected.id, storeName: selected.name, loginAt: new Date().toISOString() })
          onLogin(selected.id, selected.name)
        }
      } finally {
        setLoading(false)
      }
    } else if (step === "setup") {
      setStep("setup-confirm")
    } else if (step === "setup-confirm") {
      if (confirmPin !== pin) {
        setError("PINが一致しません")
        setConfirmPin("")
        return
      }
      setLoading(true)
      try {
        const hash = await hashPin(pin)
        await updatePinHash(selected.id, hash)
        saveSession({ storeId: selected.id, storeName: selected.name, loginAt: new Date().toISOString() })
        onLogin(selected.id, selected.name)
      } finally {
        setLoading(false)
      }
    }
  }

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "del", "0", "ok"]

  if (step === "store") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm space-y-6">
          <h1 className="text-center text-2xl font-bold tracking-tight">店舗を選択</h1>
          <div className="space-y-3">
            {stores.map((store) => (
              <Button
                key={store.id}
                variant="outline"
                className="h-14 w-full text-lg font-medium"
                onClick={() => handleStoreSelect(store)}
              >
                {store.name}
              </Button>
            ))}
            {stores.length === 0 && (
              <p className="text-center text-sm text-muted-foreground">読み込み中...</p>
            )}
          </div>
          {error && <p className="text-center text-sm text-destructive">{error}</p>}
        </div>
      </div>
    )
  }

  const title =
    step === "setup" ? "初期PINを設定"
    : step === "setup-confirm" ? "PINを再入力"
    : `${selected?.name} — PIN入力`

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-xs space-y-6">
        <div className="text-center">
          <h1 className="text-xl font-bold">{title}</h1>
          {step === "setup" && (
            <p className="mt-1 text-xs text-muted-foreground">4〜6桁のPINを設定してください</p>
          )}
        </div>

        {/* PIN ドット表示 */}
        <div className="flex justify-center gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className={`h-3 w-3 rounded-full border-2 transition-colors ${
                i < currentPin.length ? "border-primary bg-primary" : "border-muted-foreground"
              }`}
            />
          ))}
        </div>

        {error && <p className="text-center text-sm text-destructive">{error}</p>}

        {/* キーパッド */}
        <div className="grid grid-cols-3 gap-3">
          {keys.map((key) => (
            <Button
              key={key}
              variant={key === "ok" ? "default" : key === "del" ? "ghost" : "outline"}
              className="h-14 text-xl font-semibold"
              onClick={() => key === "ok" ? handleConfirm() : handleKey(key)}
              disabled={loading || (key === "ok" && currentPin.length < 4)}
            >
              {key === "del" ? <Delete className="h-5 w-5" /> : key === "ok" ? <Check className="h-5 w-5" /> : key}
            </Button>
          ))}
        </div>

        <Button
          variant="ghost"
          className="w-full text-sm text-muted-foreground"
          onClick={() => { setStep("store"); setPin(""); setConfirmPin(""); setError("") }}
        >
          ← 店舗選択に戻る
        </Button>
      </div>
    </div>
  )
}
