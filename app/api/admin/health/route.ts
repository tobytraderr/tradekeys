import { NextResponse } from "next/server"
import { getAdminHealthChecks } from "@/lib/server/ops-health"
import { recordApiEvent } from "@/lib/server/ops-observability"

export async function GET() {
  const startedAt = Date.now()

  try {
    const checks = await getAdminHealthChecks()
    const durationMs = Date.now() - startedAt
    recordApiEvent({
      route: "/api/admin/health",
      method: "GET",
      statusCode: 200,
      durationMs,
    })
    return NextResponse.json(
      {
        checks,
        overallStatus: checks.some((check) => check.status === "down")
          ? "down"
          : checks.some((check) => check.status === "degraded")
            ? "degraded"
            : "ok",
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    )
  } catch (error) {
    const durationMs = Date.now() - startedAt
    recordApiEvent({
      route: "/api/admin/health",
      method: "GET",
      statusCode: 500,
      durationMs,
    })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to run health checks." },
      { status: 500 }
    )
  }
}
