import { NextResponse } from "next/server"
import { getAdminOverview } from "@/lib/server/admin-overview"
import { recordApiEvent } from "@/lib/server/ops-observability"

export async function GET() {
  const startedAt = Date.now()
  const overview = await getAdminOverview()
  recordApiEvent({
    route: "/api/admin/overview",
    method: "GET",
    statusCode: 200,
    durationMs: Date.now() - startedAt,
  })
  return NextResponse.json(overview, {
    headers: {
      "Cache-Control": "no-store",
    },
  })
}
