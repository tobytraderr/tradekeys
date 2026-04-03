import { NextResponse } from "next/server"
import { convertBnbToUsd } from "@/lib/currency"
import { recordApiEvent } from "@/lib/server/ops-observability"
import { enforcePublicApiRateLimit } from "@/lib/server/public-api-guard"
import { fetchAddressNativeBalance, fetchBnbUsdPrice } from "@/lib/server/rpc"
import { isValidWalletAccount } from "@/lib/server/watchlist-store"

export async function GET(request: Request) {
  const rateLimited = enforcePublicApiRateLimit({
    request,
    route: "/api/wallet/balance",
    method: "GET",
    bucket: "quote",
  })
  if (rateLimited) {
    return rateLimited
  }

  const startedAt = Date.now()
  const url = new URL(request.url)
  const account = url.searchParams.get("account")?.trim() || ""

  if (!account || !isValidWalletAccount(account)) {
    recordApiEvent({
      route: "/api/wallet/balance",
      method: "GET",
      statusCode: 400,
      durationMs: Date.now() - startedAt,
    })
    return NextResponse.json({ error: "A valid wallet account is required." }, { status: 400 })
  }

  const [balance, usdPerBnb] = await Promise.all([
    fetchAddressNativeBalance(account as `0x${string}`).catch(() => null),
    fetchBnbUsdPrice().catch(() => null),
  ])

  if (!balance) {
    recordApiEvent({
      route: "/api/wallet/balance",
      method: "GET",
      statusCode: 404,
      durationMs: Date.now() - startedAt,
    })
    return NextResponse.json({ error: "Wallet balance unavailable." }, { status: 404 })
  }

  const usd =
    typeof usdPerBnb === "number" ? convertBnbToUsd(balance.bnb, usdPerBnb) : 0

  recordApiEvent({
    route: "/api/wallet/balance",
    method: "GET",
    statusCode: 200,
    durationMs: Date.now() - startedAt,
  })
  return NextResponse.json({
    account,
    wei: balance.wei,
    bnb: balance.bnb,
    usd,
  })
}
