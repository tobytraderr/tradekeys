import "server-only"

import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import { recoverMessageAddress } from "viem"
import { getDb, isDatabaseConfigured } from "@/lib/server/db"
import { isValidWalletAccount } from "@/lib/server/watchlist-store"

const WALLET_SESSION_COOKIE = "tk_wallet_session"
const CHALLENGE_TTL_MS = 5 * 60 * 1000
const SESSION_TTL_MS = 24 * 60 * 60 * 1000

type WalletChallenge = {
  account: `0x${string}`
  nonce: string
  message: string
  expiresAt: number
}

type WalletSession = {
  token: string
  account: `0x${string}`
  expiresAt: number
}

const globalState = globalThis as typeof globalThis & {
  __tradekeysWalletChallenges?: Map<string, WalletChallenge>
  __tradekeysWalletSessions?: Map<string, WalletSession>
}

const walletChallenges =
  globalState.__tradekeysWalletChallenges ??
  (globalState.__tradekeysWalletChallenges = new Map<string, WalletChallenge>())

const walletSessions =
  globalState.__tradekeysWalletSessions ??
  (globalState.__tradekeysWalletSessions = new Map<string, WalletSession>())

function parseCookieHeader(header: string | null) {
  if (!header) {
    return {}
  }

  return Object.fromEntries(
    header
      .split(";")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const separatorIndex = entry.indexOf("=")
        if (separatorIndex < 0) {
          return [entry, ""]
        }
        return [entry.slice(0, separatorIndex), decodeURIComponent(entry.slice(separatorIndex + 1))]
      })
  ) as Record<string, string>
}

function getHostLabel(request: Request) {
  try {
    return new URL(request.url).host
  } catch {
    return "TradeKeys"
  }
}

function buildChallengeMessage(account: `0x${string}`, nonce: string, request: Request) {
  const issuedAt = new Date().toISOString()
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString()
  return [
    "TradeKeys wallet verification",
    "",
    `Account: ${account}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    `Expires At: ${expiresAt}`,
    `Domain: ${getHostLabel(request)}`,
    "",
    "Sign this message to verify wallet ownership for TradeKeys settings and watchlist access.",
    "This does not submit a blockchain transaction or spend gas.",
  ].join("\n")
}

function toSessionAccount(value: string) {
  return value.toLowerCase() as `0x${string}`
}

function toTimestamp(value: string | Date | number) {
  if (typeof value === "number") {
    return value
  }

  return new Date(value).getTime()
}

async function cleanupExpiredEntries() {
  const now = Date.now()

  for (const [key, challenge] of walletChallenges.entries()) {
    if (challenge.expiresAt <= now) {
      walletChallenges.delete(key)
    }
  }

  for (const [key, session] of walletSessions.entries()) {
    if (session.expiresAt <= now) {
      walletSessions.delete(key)
    }
  }

  if (!isDatabaseConfigured()) {
    return
  }

  const db = getDb()
  await Promise.all([
    db.query(`delete from wallet_auth_challenges where expires_at <= now()`),
    db.query(`delete from wallet_auth_sessions where expires_at <= now()`),
  ])
}

async function storeChallenge(challenge: WalletChallenge) {
  walletChallenges.set(challenge.nonce, challenge)

  if (!isDatabaseConfigured()) {
    return
  }

  const db = getDb()
  await db.query(
    `
    insert into wallet_auth_challenges (nonce, account, message, expires_at)
    values ($1, $2, $3, to_timestamp($4 / 1000.0))
    on conflict (nonce) do update
      set account = excluded.account,
          message = excluded.message,
          expires_at = excluded.expires_at
    `,
    [challenge.nonce, challenge.account, challenge.message, challenge.expiresAt]
  )
}

async function readChallenge(nonce: string) {
  const memoryChallenge = walletChallenges.get(nonce)
  if (memoryChallenge) {
    return memoryChallenge
  }

  if (!isDatabaseConfigured()) {
    return null
  }

  const db = getDb()
  const result = await db.query(
    `
    select nonce, account, message, expires_at
    from wallet_auth_challenges
    where nonce = $1
    `,
    [nonce]
  )

  const row = result.rows[0]
  if (!row) {
    return null
  }

  const challenge: WalletChallenge = {
    nonce: String(row.nonce),
    account: toSessionAccount(String(row.account)),
    message: String(row.message),
    expiresAt: toTimestamp(row.expires_at),
  }

  walletChallenges.set(challenge.nonce, challenge)
  return challenge
}

async function deleteChallenge(nonce: string) {
  walletChallenges.delete(nonce)

  if (!isDatabaseConfigured()) {
    return
  }

  const db = getDb()
  await db.query(`delete from wallet_auth_challenges where nonce = $1`, [nonce])
}

async function storeSession(session: WalletSession) {
  walletSessions.set(session.token, session)

  if (!isDatabaseConfigured()) {
    return
  }

  const db = getDb()
  await db.query(
    `
    insert into wallet_auth_sessions (token, account, expires_at)
    values ($1, $2, to_timestamp($3 / 1000.0))
    on conflict (token) do update
      set account = excluded.account,
          expires_at = excluded.expires_at
    `,
    [session.token, session.account, session.expiresAt]
  )
}

async function readSession(token: string) {
  const memorySession = walletSessions.get(token)
  if (memorySession) {
    return memorySession
  }

  if (!isDatabaseConfigured()) {
    return null
  }

  const db = getDb()
  const result = await db.query(
    `
    select token, account, expires_at
    from wallet_auth_sessions
    where token = $1
    `,
    [token]
  )

  const row = result.rows[0]
  if (!row) {
    return null
  }

  const session: WalletSession = {
    token: String(row.token),
    account: toSessionAccount(String(row.account)),
    expiresAt: toTimestamp(row.expires_at),
  }

  walletSessions.set(session.token, session)
  return session
}

async function deleteSession(token: string) {
  walletSessions.delete(token)

  if (!isDatabaseConfigured()) {
    return
  }

  const db = getDb()
  await db.query(`delete from wallet_auth_sessions where token = $1`, [token])
}

export function getWalletSessionCookieName() {
  return WALLET_SESSION_COOKIE
}

export async function createWalletChallenge(request: Request, account: string) {
  await cleanupExpiredEntries()
  if (!isValidWalletAccount(account)) {
    throw new Error("A valid wallet account is required.")
  }

  const normalizedAccount = toSessionAccount(account)
  const nonce = randomUUID()
  const expiresAt = Date.now() + CHALLENGE_TTL_MS
  const message = buildChallengeMessage(normalizedAccount, nonce, request)

  await storeChallenge({
    account: normalizedAccount,
    nonce,
    message,
    expiresAt,
  })

  return {
    account: normalizedAccount,
    nonce,
    message,
    expiresAt: new Date(expiresAt).toISOString(),
  }
}

export async function verifyWalletChallenge(input: {
  account: string
  nonce: string
  signature: string
}) {
  await cleanupExpiredEntries()

  if (!isValidWalletAccount(input.account)) {
    throw new Error("A valid wallet account is required.")
  }

  const normalizedAccount = toSessionAccount(input.account)
  const challenge = await readChallenge(input.nonce)
  if (!challenge || challenge.expiresAt <= Date.now()) {
    await deleteChallenge(input.nonce)
    throw new Error("Wallet verification challenge expired. Please sign a fresh challenge.")
  }
  if (challenge.account !== normalizedAccount) {
    throw new Error("Wallet verification challenge does not match the requested account.")
  }

  const recoveredAddress = toSessionAccount(
    await recoverMessageAddress({
      message: challenge.message,
      signature: input.signature as `0x${string}`,
    })
  )
  if (recoveredAddress !== normalizedAccount) {
    throw new Error("Wallet signature does not match the requested account.")
  }

  await deleteChallenge(input.nonce)
  const token = randomUUID()
  const expiresAt = Date.now() + SESSION_TTL_MS

  await storeSession({
    token,
    account: normalizedAccount,
    expiresAt,
  })

  return {
    token,
    account: normalizedAccount,
    expiresAt: new Date(expiresAt).toISOString(),
  }
}

export function attachWalletSessionCookie(response: NextResponse, input: { token: string; request: Request }) {
  response.cookies.set(WALLET_SESSION_COOKIE, input.token, {
    httpOnly: true,
    sameSite: "strict",
    secure: new URL(input.request.url).protocol === "https:",
    path: "/",
    expires: new Date(Date.now() + SESSION_TTL_MS),
  })
}

export async function clearWalletSessionCookie(response: NextResponse, request: Request) {
  const cookies = parseCookieHeader(request.headers.get("cookie"))
  const token = cookies[WALLET_SESSION_COOKIE]
  if (token) {
    await deleteSession(token)
  }

  response.cookies.set(WALLET_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    expires: new Date(0),
  })
}

export async function getWalletSessionAccount(request: Request) {
  await cleanupExpiredEntries()
  const cookies = parseCookieHeader(request.headers.get("cookie"))
  const token = cookies[WALLET_SESSION_COOKIE]
  if (!token) {
    return null
  }

  const session = await readSession(token)
  if (!session || session.expiresAt <= Date.now()) {
    await deleteSession(token)
    return null
  }

  return session.account
}

export function buildWalletSessionErrorResponse(status: 400 | 401 | 403, message: string) {
  return NextResponse.json({ error: message }, { status })
}

export async function requireVerifiedWalletSession(request: Request, claimedAccount: string) {
  if (!isValidWalletAccount(claimedAccount)) {
    return buildWalletSessionErrorResponse(401, "A valid wallet account is required.")
  }

  const sessionAccount = await getWalletSessionAccount(request)
  if (!sessionAccount) {
    return buildWalletSessionErrorResponse(
      401,
      "Wallet verification required. Reconnect and sign the verification challenge."
    )
  }

  if (sessionAccount !== toSessionAccount(claimedAccount)) {
    return buildWalletSessionErrorResponse(
      403,
      "This request does not match the verified wallet session."
    )
  }

  return null
}

export async function getWalletSessionStatus(request: Request, account: string | null | undefined) {
  const sessionAccount = await getWalletSessionAccount(request)
  const normalizedRequestedAccount =
    account && isValidWalletAccount(account) ? toSessionAccount(account) : null

  return {
    authenticated: Boolean(
      sessionAccount && normalizedRequestedAccount && sessionAccount === normalizedRequestedAccount
    ),
    sessionAccount,
  }
}
