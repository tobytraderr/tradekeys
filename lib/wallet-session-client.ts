"use client"

type SessionStatusResponse = {
  authenticated?: boolean
  account?: string | null
  sessionAccount?: string | null
  error?: string
}

type ChallengeResponse = {
  account: string
  nonce: string
  message: string
  expiresAt: string
  error?: string
}

type VerifyResponse = {
  authenticated?: boolean
  account?: string
  expiresAt?: string
  error?: string
}

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>
      on?: (event: string, handler: (...args: unknown[]) => void) => void
      removeListener?: (event: string, handler: (...args: unknown[]) => void) => void
    }
  }
  interface WindowEventMap {
    "tradekeys:wallet-session-updated": CustomEvent<{ account: string | null }>
  }
}

let verifiedAccount: string | null = null
let inflightSessionAccount: string | null = null
let inflightSessionPromise: Promise<void> | null = null

function normalizeAccount(value: string) {
  return value.trim().toLowerCase()
}

function emitWalletSessionUpdate(account: string | null) {
  verifiedAccount = account ? normalizeAccount(account) : null
  window.dispatchEvent(
    new CustomEvent("tradekeys:wallet-session-updated", {
      detail: { account: verifiedAccount },
    })
  )
}

export async function ensureWalletSession(account: string) {
  const normalizedAccount = normalizeAccount(account)
  if (verifiedAccount === normalizedAccount) {
    return
  }
  if (inflightSessionPromise && inflightSessionAccount === normalizedAccount) {
    return inflightSessionPromise
  }

  inflightSessionAccount = normalizedAccount
  inflightSessionPromise = (async () => {
    const statusResponse = await fetch(`/api/wallet/session?account=${encodeURIComponent(normalizedAccount)}`, {
      cache: "no-store",
      credentials: "include",
    })
    const statusPayload = (await statusResponse.json()) as SessionStatusResponse
    if (statusResponse.ok && statusPayload.authenticated) {
      emitWalletSessionUpdate(normalizedAccount)
      return
    }

    if (!window.ethereum) {
      throw new Error("A browser wallet is required.")
    }

    const challengeResponse = await fetch("/api/wallet/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ account: normalizedAccount }),
    })
    const challengePayload = (await challengeResponse.json()) as ChallengeResponse
    if (!challengeResponse.ok || !challengePayload.message || !challengePayload.nonce) {
      throw new Error(challengePayload.error || "Failed to create wallet verification challenge.")
    }

    const signature = await window.ethereum.request({
      method: "personal_sign",
      params: [challengePayload.message, normalizedAccount],
    })
    if (typeof signature !== "string" || !signature.trim()) {
      throw new Error("Wallet signature was not produced.")
    }

    const verifyResponse = await fetch("/api/wallet/session", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        account: normalizedAccount,
        nonce: challengePayload.nonce,
        signature,
      }),
    })
    const verifyPayload = (await verifyResponse.json()) as VerifyResponse
    if (!verifyResponse.ok || !verifyPayload.authenticated) {
      throw new Error(verifyPayload.error || "Wallet verification failed.")
    }

    emitWalletSessionUpdate(normalizedAccount)
  })()

  try {
    await inflightSessionPromise
  } finally {
    inflightSessionPromise = null
    inflightSessionAccount = null
  }
}

export async function clearWalletSession() {
  verifiedAccount = null
  await fetch("/api/wallet/session", {
    method: "DELETE",
    credentials: "include",
  }).catch(() => undefined)
  emitWalletSessionUpdate(null)
}

export function getVerifiedWalletSessionAccount() {
  return verifiedAccount
}
