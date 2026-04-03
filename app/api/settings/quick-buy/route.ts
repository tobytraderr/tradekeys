import { NextResponse } from "next/server"
import {
  getQuickBuyAmount,
  setQuickBuyAmount,
} from "@/lib/server/quick-buy-settings-store"
import { isDatabaseConfigured } from "@/lib/server/db"
import { requireVerifiedWalletSession } from "@/lib/server/wallet-session"
import { isValidWalletAccount } from "@/lib/server/watchlist-store"

export async function GET(request: Request) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Quick buy settings require DATABASE_URL to be configured." },
      { status: 503 }
    )
  }

  const url = new URL(request.url)
  const account = url.searchParams.get("account")?.trim() ?? ""
  if (!isValidWalletAccount(account)) {
    return NextResponse.json({ error: "Valid wallet account is required." }, { status: 400 })
  }

  const sessionError = await requireVerifiedWalletSession(request, account)
  if (sessionError) {
    return sessionError
  }

  const quickBuyAmount = await getQuickBuyAmount(account)
  return NextResponse.json({ quickBuyAmount })
}

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Quick buy settings require DATABASE_URL to be configured." },
      { status: 503 }
    )
  }

  const body = (await request.json().catch(() => null)) as
    | { account?: string; quickBuyAmount?: number | string | null }
    | null

  const account = body?.account?.trim() ?? ""
  if (!isValidWalletAccount(account)) {
    return NextResponse.json({ error: "Valid wallet account is required." }, { status: 400 })
  }

  const sessionError = await requireVerifiedWalletSession(request, account)
  if (sessionError) {
    return sessionError
  }

  const rawAmount = body?.quickBuyAmount
  if (rawAmount === null) {
    await setQuickBuyAmount(account, null)
    return NextResponse.json({ quickBuyAmount: null })
  }

  const numericAmount = Number(rawAmount)
  if (!Number.isInteger(numericAmount) || numericAmount <= 0) {
    return NextResponse.json(
      { error: "Quick buy amount must be a whole number greater than zero." },
      { status: 400 }
    )
  }

  await setQuickBuyAmount(account, numericAmount)
  return NextResponse.json({ quickBuyAmount: numericAmount })
}
