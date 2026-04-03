import "server-only"

import { NextResponse } from "next/server"
import {
  getPublicApiCopilotLimit,
  getPublicApiImageLimit,
  getPublicApiMarketReadLimit,
  getPublicApiQuoteLimit,
  getPublicApiRateLimitWindowMs,
  getPublicApiSearchLimit,
} from "@/lib/env"
import { recordApiEvent, recordOpsEvent } from "@/lib/server/ops-observability"

type RateLimitEntry = {
  count: number
  resetAt: number
}

type PublicApiBucket = "market-read" | "search" | "quote" | "image" | "copilot"

type PublicApiGuardInput = {
  request: Request
  route: string
  method: string
  bucket: PublicApiBucket
}

const globalState = globalThis as typeof globalThis & {
  __tradekeysPublicApiLimiter?: Map<string, RateLimitEntry>
}

const limiter =
  globalState.__tradekeysPublicApiLimiter ??
  (globalState.__tradekeysPublicApiLimiter = new Map<string, RateLimitEntry>())

function getRequestIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() ?? "unknown"
  }

  return request.headers.get("x-real-ip")?.trim() ?? "unknown"
}

function getBucketLimit(bucket: PublicApiBucket) {
  switch (bucket) {
    case "search":
      return getPublicApiSearchLimit()
    case "quote":
      return getPublicApiQuoteLimit()
    case "image":
      return getPublicApiImageLimit()
    case "copilot":
      return getPublicApiCopilotLimit()
    case "market-read":
    default:
      return getPublicApiMarketReadLimit()
  }
}

function consumeLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now()
  const current = limiter.get(key)
  if (!current || current.resetAt <= now) {
    const next = { count: 1, resetAt: now + windowMs }
    limiter.set(key, next)
    return {
      allowed: true,
      remaining: Math.max(0, limit - 1),
      resetAt: next.resetAt,
    }
  }

  current.count += 1
  if (current.count > limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: current.resetAt,
    }
  }

  return {
    allowed: true,
    remaining: Math.max(0, limit - current.count),
    resetAt: current.resetAt,
  }
}

export function enforcePublicApiRateLimit(input: PublicApiGuardInput) {
  const limit = getBucketLimit(input.bucket)
  const windowMs = getPublicApiRateLimitWindowMs()
  const clientIp = getRequestIp(input.request)
  const key = `${input.bucket}:${clientIp}:${input.route}`
  const result = consumeLimit(key, limit, windowMs)

  if (result.allowed) {
    return null
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))
  recordApiEvent({
    route: input.route,
    method: input.method,
    statusCode: 429,
  })
  recordOpsEvent({
    level: "warn",
    category: "api",
    name: `${input.route}.rate_limited`,
    message: `Public API rate limit exceeded for ${input.bucket}`,
    dependency: "app",
    statusCode: 429,
    data: {
      bucket: input.bucket,
      clientIp,
      retryAfterSeconds,
    },
  })

  return NextResponse.json(
    { error: "Too many requests. Please slow down and try again shortly." },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSeconds),
      },
    }
  )
}
