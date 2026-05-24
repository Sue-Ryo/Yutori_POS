const SESSION_KEY = "pos_session"

export interface AppSession {
  storeId: number
  storeName: string
  loginAt: string
}

function getExpiryTime(): Date {
  const now = new Date()
  const today8am = new Date(now)
  today8am.setHours(8, 0, 0, 0)
  if (now >= today8am) return today8am
  const yesterday8am = new Date(today8am)
  yesterday8am.setDate(yesterday8am.getDate() - 1)
  return yesterday8am
}

export function getSession(): AppSession | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function isSessionValid(session: AppSession | null): boolean {
  if (!session) return false
  return new Date(session.loginAt) >= getExpiryTime()
}

export function saveSession(session: AppSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY)
}
