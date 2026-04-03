import { NextResponse } from "next/server"
import { clearFeaturedOverride, getFeaturedOverride, setFeaturedOverride } from "@/lib/server/featured-store"

export async function GET() {
  const record = await getFeaturedOverride()
  return NextResponse.json({ override: record })
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { twinId?: string; label?: string } | null
  const twinId = body?.twinId?.trim()
  if (!twinId) {
    return NextResponse.json({ error: "twinId is required" }, { status: 400 })
  }

  try {
    const record = await setFeaturedOverride({ twinId, label: body?.label })
    return NextResponse.json({ override: record })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid override" },
      { status: 400 }
    )
  }
}

export async function DELETE() {
  await clearFeaturedOverride()
  return NextResponse.json({ ok: true })
}
