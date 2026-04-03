import { NextResponse } from "next/server"
import { getTwinDetailResult } from "@/lib/services/market/detail"
import { recordApiEvent } from "@/lib/server/ops-observability"
import { enforcePublicApiRateLimit } from "@/lib/server/public-api-guard"

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const rateLimited = enforcePublicApiRateLimit({
    request,
    route: "/api/twins/[id]",
    method: "GET",
    bucket: "market-read",
  })
  if (rateLimited) {
    return rateLimited
  }

  const startedAt = Date.now()
  const { id } = await context.params
  const result = await getTwinDetailResult(id)
  const twin = result.twin
  if (!twin && result.unavailable) {
    recordApiEvent({
      route: "/api/twins/[id]",
      method: "GET",
      statusCode: 503,
      durationMs: Date.now() - startedAt,
    })
    return NextResponse.json(
      { error: result.error ?? "Twin market data is temporarily unavailable." },
      { status: 503 }
    )
  }
  if (!twin) {
    recordApiEvent({
      route: "/api/twins/[id]",
      method: "GET",
      statusCode: 404,
      durationMs: Date.now() - startedAt,
    })
    return NextResponse.json({ error: "Twin not found" }, { status: 404 })
  }
  recordApiEvent({
    route: "/api/twins/[id]",
    method: "GET",
    statusCode: 200,
    durationMs: Date.now() - startedAt,
  })
  return NextResponse.json(twin)
}
