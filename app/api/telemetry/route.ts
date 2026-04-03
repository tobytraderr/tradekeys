import { NextResponse } from "next/server"
import { recordApiEvent, recordClientFailure } from "@/lib/server/ops-observability"

export async function POST(request: Request) {
  const startedAt = Date.now()

  try {
    const body = (await request.json().catch(() => null)) as
      | {
          name?: "wallet_connect_failure" | "transaction_submission_failure"
          message?: string
          data?: Record<string, unknown>
        }
      | null

    if (!body?.name || !body?.message) {
      const durationMs = Date.now() - startedAt
      recordApiEvent({
        route: "/api/telemetry",
        method: "POST",
        statusCode: 400,
        durationMs,
      })
      return NextResponse.json({ error: "name and message are required." }, { status: 400 })
    }

    recordClientFailure({
      name: body.name,
      message: body.message,
      data: body.data,
    })

    const durationMs = Date.now() - startedAt
    recordApiEvent({
      route: "/api/telemetry",
      method: "POST",
      statusCode: 200,
      durationMs,
    })

    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    const durationMs = Date.now() - startedAt
    recordApiEvent({
      route: "/api/telemetry",
      method: "POST",
      statusCode: 500,
      durationMs,
    })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Telemetry ingestion failed." },
      { status: 500 }
    )
  }
}
