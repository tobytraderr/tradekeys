import { NextResponse } from "next/server"
import { getImageProxyAllowedHosts, getMaxImageProxyBytes } from "@/lib/env"
import { recordApiEvent } from "@/lib/server/ops-observability"
import { enforcePublicApiRateLimit } from "@/lib/server/public-api-guard"
import { normalizeSafeRemoteUrl } from "@/lib/server/remote-resource"

function detectContentType(bytes: Uint8Array, fallback?: string | null) {
  const hint = fallback?.toLowerCase() ?? ""
  if (hint.startsWith("image/")) return hint

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png"
  }

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg"
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp"
  }

  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return "image/gif"
  }

  return "application/octet-stream"
}

export async function GET(request: Request) {
  const rateLimited = enforcePublicApiRateLimit({
    request,
    route: "/api/image",
    method: "GET",
    bucket: "image",
  })
  if (rateLimited) {
    return rateLimited
  }

  const startedAt = Date.now()
  const { searchParams } = new URL(request.url)
  const rawUrl = searchParams.get("url")?.trim()

  if (!rawUrl) {
    recordApiEvent({
      route: "/api/image",
      method: "GET",
      statusCode: 400,
      durationMs: Date.now() - startedAt,
    })
    return NextResponse.json({ error: "url is required" }, { status: 400 })
  }

  try {
    const remoteUrl = await normalizeSafeRemoteUrl(rawUrl, {
      label: "Image URL",
      allowedHosts: getImageProxyAllowedHosts(),
    })

    const upstream = await fetch(remoteUrl, {
      method: "GET",
      cache: "force-cache",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null)

    if (!upstream || !upstream.ok) {
      const status = upstream?.status ?? 502
      recordApiEvent({
        route: "/api/image",
        method: "GET",
        statusCode: status,
        durationMs: Date.now() - startedAt,
      })
      return NextResponse.json({ error: "image unavailable" }, { status })
    }

    const advertisedLength = Number(upstream.headers.get("content-length"))
    const maxBytes = getMaxImageProxyBytes()
    if (Number.isFinite(advertisedLength) && advertisedLength > maxBytes) {
      recordApiEvent({
        route: "/api/image",
        method: "GET",
        statusCode: 413,
        durationMs: Date.now() - startedAt,
      })
      return NextResponse.json({ error: "image exceeds max size" }, { status: 413 })
    }

    const buffer = await upstream.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    if (bytes.byteLength > maxBytes) {
      recordApiEvent({
        route: "/api/image",
        method: "GET",
        statusCode: 413,
        durationMs: Date.now() - startedAt,
      })
      return NextResponse.json({ error: "image exceeds max size" }, { status: 413 })
    }

    const contentType = detectContentType(bytes, upstream.headers.get("content-type"))
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(contentType)) {
      recordApiEvent({
        route: "/api/image",
        method: "GET",
        statusCode: 415,
        durationMs: Date.now() - startedAt,
      })
      return NextResponse.json({ error: "unsupported image type" }, { status: 415 })
    }

    recordApiEvent({
      route: "/api/image",
      method: "GET",
      statusCode: 200,
      durationMs: Date.now() - startedAt,
    })
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    recordApiEvent({
      route: "/api/image",
      method: "GET",
      statusCode: 400,
      durationMs: Date.now() - startedAt,
    })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid image request." },
      { status: 400 }
    )
  }
}
