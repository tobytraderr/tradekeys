import { NextResponse } from "next/server"
import { getTrendingTwins } from "@/lib/services/market/homepage"
import { recordApiEvent } from "@/lib/server/ops-observability"
import { enforcePublicApiRateLimit } from "@/lib/server/public-api-guard"

export async function GET(request: Request) {
  const rateLimited = enforcePublicApiRateLimit({
    request,
    route: "/api/twins/trending",
    method: "GET",
    bucket: "market-read",
  })
  if (rateLimited) {
    return rateLimited
  }

  const startedAt = Date.now()
  const twins = await getTrendingTwins()
  recordApiEvent({
    route: "/api/twins/trending",
    method: "GET",
    statusCode: 200,
    durationMs: Date.now() - startedAt,
  })
  return NextResponse.json({ twins })
}
