import { NextResponse } from "next/server"
import { getAppMeta } from "@/lib/services/twins"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const meta = await getAppMeta()
    return NextResponse.json(
      {
        totalTwins: meta.totalTwins,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    )
  } catch {
    return NextResponse.json(
      {
        totalTwins: 0,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    )
  }
}
