"use client"

import { useState, useEffect } from "react"
import { getSession, isSessionValid, type AppSession } from "@/lib/session"
import { LoginScreen } from "@/components/auth/login-screen"
import { POSSystem } from "@/components/pos/pos-system"

export default function Home() {
  const [session, setSession] = useState<AppSession | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const s = getSession()
    if (isSessionValid(s)) setSession(s)
    setLoaded(true)
  }, [])

  if (!loaded) return null

  if (!session) {
    return (
      <LoginScreen
        onLogin={(storeId, storeName) =>
          setSession({ storeId, storeName, loginAt: new Date().toISOString() })
        }
      />
    )
  }

  return <POSSystem storeId={session.storeId} />
}
