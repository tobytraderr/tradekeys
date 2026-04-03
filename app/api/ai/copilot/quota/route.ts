import { NextResponse } from "next/server"
import { recordApiEvent } from "@/lib/server/ops-observability"
import { getCopilotQuotaSnapshot } from "@/lib/server/copilot-quota-store"
import { isValidWalletAccount } from "@/lib/server/watchlist-store"

export async function GET(request: Request) {
  const startedAt = Date.now()
  const url = new URL(request.url)
  const account = url.searchParams.get("account")?.trim()

  if (account && !isValidWalletAccount(account)) {
    recordApiEvent({
      route: "/api/ai/copilot/quota",
      method: "GET",
      statusCode: 400,
      durationMs: Date.now() - startedAt,
    })
    return NextResponse.json({ error: "A valid wallet account is required." }, { status: 400 })
  }

  const quota = await getCopilotQuotaSnapshot({
    request,
    account,
  })

  recordApiEvent({
    route: "/api/ai/copilot/quota",
    method: "GET",
    statusCode: 200,
    durationMs: Date.now() - startedAt,
  })

  return NextResponse.json(
    { quota },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  )
}
