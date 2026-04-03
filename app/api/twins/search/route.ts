import { NextResponse } from "next/server"
import { searchTwins } from "@/lib/services/market/search"
import { recordApiEvent } from "@/lib/server/ops-observability"
import { enforcePublicApiRateLimit } from "@/lib/server/public-api-guard"

export async function GET(request: Request) {
  const rateLimited = enforcePublicApiRateLimit({
    request,
    route: "/api/twins/search",
    method: "GET",
    bucket: "search",
  })
  if (rateLimited) {
    return rateLimited
  }

  const startedAt = Date.now()
  const url = new URL(request.url)
  const query = url.searchParams.get("q")?.trim() ?? ""

  if (!query) {
    recordApiEvent({
      route: "/api/twins/search",
      method: "GET",
      statusCode: 200,
      durationMs: Date.now() - startedAt,
    })
    return NextResponse.json({ results: [] })
  }

  if (query.length > 120) {
    recordApiEvent({
      route: "/api/twins/search",
      method: "GET",
      statusCode: 400,
      durationMs: Date.now() - startedAt,
    })
    return NextResponse.json({ error: "Search query is too long." }, { status: 400 })
  }

  const results = await searchTwins(query)
  recordApiEvent({
    route: "/api/twins/search",
    method: "GET",
    statusCode: 200,
    durationMs: Date.now() - startedAt,
  })
  return NextResponse.json(
    {
      results,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  )
}
