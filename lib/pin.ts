export async function hashPin(pin: string): Promise<string> {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pin))
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  if (!hash) return false
  return (await hashPin(pin)) === hash
}
