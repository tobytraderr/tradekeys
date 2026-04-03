import { NextResponse } from "next/server"
import { recordApiEvent } from "@/lib/server/ops-observability"
import { enforcePublicApiRateLimit } from "@/lib/server/public-api-guard"
import {
  getCreateTwinQuote,
  validateCreateTwinPreflight,
} from "@/lib/server/execution"

export async function GET(request: Request) {
  const rateLimited = enforcePublicApiRateLimit({
    request,
    route: "/api/twins/create",
    method: "GET",
    bucket: "quote",
  })
  if (rateLimited) {
    return rateLimited
  }

  const startedAt = Date.now()
  const url = new URL(request.url)
  const twinId = url.searchParams.get("id")?.trim() ?? ""

  try {
    const quote = await getCreateTwinQuote(twinId)
    recordApiEvent({
      route: "/api/twins/create",
      method: "GET",
      statusCode: 200,
      durationMs: Date.now() - startedAt,
    })
    return NextResponse.json(quote, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Creation quote unavailable."
    const status = /bytes16/i.test(message) ? 400 : 503
    recordApiEvent({
      route: "/api/twins/create",
      method: "GET",
      statusCode: status,
      durationMs: Date.now() - startedAt,
    })
    return NextResponse.json(
      { error: message },
      { status }
    )
  }
}

export async function POST(request: Request) {
  const rateLimited = enforcePublicApiRateLimit({
    request,
    route: "/api/twins/create",
    method: "POST",
    bucket: "quote",
  })
  if (rateLimited) {
    return rateLimited
  }

  const startedAt = Date.now()
  const body = (await request.json().catch(() => null)) as
    | { twinId?: string; metadataUrl?: string; account?: string }
    | null

  try {
    const payload = await validateCreateTwinPreflight({
      twinId: body?.twinId?.trim() ?? "",
      metadataUrl: body?.metadataUrl?.trim() ?? "",
      ...(body?.account?.trim() ? { account: body.account.trim() } : {}),
    })

    recordApiEvent({
      route: "/api/twins/create",
      method: "POST",
      statusCode: 200,
      durationMs: Date.now() - startedAt,
    })
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Creation validation failed."
    const status = /valid|required|url|bytes16|claimed|exists/i.test(message) ? 400 : 503
    recordApiEvent({
      route: "/api/twins/create",
      method: "POST",
      statusCode: status,
      durationMs: Date.now() - startedAt,
    })
    return NextResponse.json({ error: message }, { status })
  }
}
