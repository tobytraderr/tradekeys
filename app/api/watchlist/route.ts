import { NextResponse } from "next/server"
import { isDatabaseConfigured } from "@/lib/server/db"
import { isValidTwinId, normalizeTwinId } from "@/lib/server/execution"
import { requireVerifiedWalletSession } from "@/lib/server/wallet-session"
import { getTwinDetailResult } from "@/lib/services/market/detail"
import { getWatchlistTwinsForAccount } from "@/lib/services/market/watchlist"
import {
  addWatchlistTwin,
  isValidWalletAccount,
  removeWatchlistTwin,
} from "@/lib/server/watchlist-store"

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

function serviceUnavailable() {
  return NextResponse.json(
    { error: "Watchlist persistence requires DATABASE_URL to be configured." },
    { status: 503 }
  )
}

export async function GET(request: Request) {
  if (!isDatabaseConfigured()) {
    return serviceUnavailable()
  }
  const url = new URL(request.url)
  const account = url.searchParams.get("account")?.trim() ?? ""

  if (!isValidWalletAccount(account)) {
    return badRequest("A valid wallet account is required.")
  }

  const sessionError = await requireVerifiedWalletSession(request, account)
  if (sessionError) {
    return sessionError
  }

  const items = await getWatchlistTwinsForAccount(account)
  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } })
}

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) {
    return serviceUnavailable()
  }
  const body = (await request.json().catch(() => null)) as
    | { account?: string; twinId?: string }
    | null
  const account = body?.account?.trim() ?? ""
  const twinId = normalizeTwinId(body?.twinId ?? "")

  if (!isValidWalletAccount(account)) {
    return badRequest("A valid wallet account is required.")
  }
  const sessionError = await requireVerifiedWalletSession(request, account)
  if (sessionError) {
    return sessionError
  }
  if (!isValidTwinId(twinId)) {
    return badRequest("Twin ID must be a valid 0x-prefixed bytes16 value.")
  }

  const twinResult = await getTwinDetailResult(twinId)
  if (!twinResult.twin && twinResult.unavailable) {
    return NextResponse.json(
      { error: twinResult.error ?? "Twin market data is temporarily unavailable." },
      { status: 503 }
    )
  }
  if (!twinResult.twin) {
    return NextResponse.json({ error: "Twin not found." }, { status: 404 })
  }

  await addWatchlistTwin(account, twinId)
  const items = await getWatchlistTwinsForAccount(account)
  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } })
}

export async function DELETE(request: Request) {
  if (!isDatabaseConfigured()) {
    return serviceUnavailable()
  }
  const body = (await request.json().catch(() => null)) as
    | { account?: string; twinId?: string }
    | null
  const account = body?.account?.trim() ?? ""
  const twinId = normalizeTwinId(body?.twinId ?? "")

  if (!isValidWalletAccount(account)) {
    return badRequest("A valid wallet account is required.")
  }
  const sessionError = await requireVerifiedWalletSession(request, account)
  if (sessionError) {
    return sessionError
  }
  if (!isValidTwinId(twinId)) {
    return badRequest("Twin ID must be a valid 0x-prefixed bytes16 value.")
  }

  await removeWatchlistTwin(account, twinId)
  const items = await getWatchlistTwinsForAccount(account)
  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } })
}
