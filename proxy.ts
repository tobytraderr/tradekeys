import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import {
  getAdminAccessTokenValue,
  hasValidAdminAuthorization,
  isAdminConfigured,
  isAllowedAdminIp,
  isValidAdminAccessToken,
} from "@/lib/admin-auth"

const ADMIN_REALM = 'Basic realm="TradeKeys Admin", charset="UTF-8"'
const ADMIN_ACCESS_COOKIE = "tk_admin_access"
const FAILED_AUTH_WINDOW_MS = 5 * 60 * 1000
const FAILED_AUTH_LIMIT = 10
const ADMIN_REQUEST_WINDOW_MS = 60 * 1000
const ADMIN_REQUEST_LIMIT = 120

type RateLimitEntry = {
  count: number
  resetAt: number
}

const globalState = globalThis as typeof globalThis & {
  __tradekeysAdminFailedAuthLimiter?: Map<string, RateLimitEntry>
  __tradekeysAdminRequestLimiter?: Map<string, RateLimitEntry>
}

const failedAuthLimiter =
  globalState.__tradekeysAdminFailedAuthLimiter ??
  (globalState.__tradekeysAdminFailedAuthLimiter = new Map<string, RateLimitEntry>())

const requestLimiter =
  globalState.__tradekeysAdminRequestLimiter ??
  (globalState.__tradekeysAdminRequestLimiter = new Map<string, RateLimitEntry>())

function getClientIp(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for")
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() ?? null
  }

  return request.headers.get("x-real-ip")?.trim() ?? null
}

function consumeRateLimit(
  store: Map<string, RateLimitEntry>,
  key: string,
  limit: number,
  windowMs: number
) {
  const now = Date.now()
  const existing = store.get(key)
  if (!existing || existing.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs }
  }

  existing.count += 1
  if (existing.count > limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: existing.resetAt,
    }
  }

  return {
    allowed: true,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
  }
}

function tooManyRequestsResponse(resetAt: number) {
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))
  return NextResponse.json(
    { error: "Too many admin requests. Please wait and try again." },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSeconds),
      },
    }
  )
}

function unauthorizedResponse(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/admin")) {
    return NextResponse.json(
      { error: "Admin authentication required." },
      {
        status: 401,
        headers: {
          "WWW-Authenticate": ADMIN_REALM,
        },
      }
    )
  }

  return new NextResponse("Admin authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": ADMIN_REALM,
    },
  })
}

function notFoundResponse(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/admin")) {
    return NextResponse.json({ error: "Not found." }, { status: 404 })
  }

  return new NextResponse("Not found.", { status: 404 })
}

function forbiddenResponse(request: NextRequest, message: string) {
  if (request.nextUrl.pathname.startsWith("/api/admin")) {
    return NextResponse.json({ error: message }, { status: 403 })
  }

  return new NextResponse(message, { status: 403 })
}

function tokenRequiredResponse(request: NextRequest) {
  const message = "Admin access token required."
  if (request.nextUrl.pathname.startsWith("/api/admin")) {
    return NextResponse.json({ error: message }, { status: 401 })
  }

  return new NextResponse(message, { status: 401 })
}

function isSafeMethod(method: string) {
  return method === "GET" || method === "HEAD" || method === "OPTIONS"
}

function hasSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin")
  if (origin) {
    return origin === request.nextUrl.origin
  }

  const referer = request.headers.get("referer")
  if (!referer) {
    return false
  }

  try {
    return new URL(referer).origin === request.nextUrl.origin
  } catch {
    return false
  }
}

function getAccessTokenCandidate(request: NextRequest) {
  return (
    request.headers.get("x-admin-access-token") ??
    request.cookies.get(ADMIN_ACCESS_COOKIE)?.value ??
    request.nextUrl.searchParams.get("admin_token")
  )
}

export function proxy(request: NextRequest) {
  if (!isAdminConfigured()) {
    return notFoundResponse(request)
  }

  const clientIp = getClientIp(request)
  if (!isAllowedAdminIp(clientIp)) {
    return forbiddenResponse(request, "This IP is not allowed to access the admin surface.")
  }

  const authAttemptKey = `${clientIp ?? "unknown"}:${request.nextUrl.pathname}`
  const activeRequestKey = `${clientIp ?? "unknown"}:active`

  const accessToken = getAccessTokenCandidate(request)
  const requiredAccessToken = getAdminAccessTokenValue()
  if (requiredAccessToken && !isValidAdminAccessToken(accessToken)) {
    const failedAttempt = consumeRateLimit(
      failedAuthLimiter,
      authAttemptKey,
      FAILED_AUTH_LIMIT,
      FAILED_AUTH_WINDOW_MS
    )
    if (!failedAttempt.allowed) {
      return tooManyRequestsResponse(failedAttempt.resetAt)
    }

    return tokenRequiredResponse(request)
  }

  if (hasValidAdminAuthorization(request.headers.get("authorization"))) {
    if (
      request.nextUrl.pathname.startsWith("/api/admin") &&
      !isSafeMethod(request.method) &&
      !hasSameOrigin(request)
    ) {
      return forbiddenResponse(request, "Cross-site admin writes are blocked.")
    }

    const activeRequest = consumeRateLimit(
      requestLimiter,
      activeRequestKey,
      ADMIN_REQUEST_LIMIT,
      ADMIN_REQUEST_WINDOW_MS
    )
    if (!activeRequest.allowed) {
      return tooManyRequestsResponse(activeRequest.resetAt)
    }

    if (
      requiredAccessToken &&
      request.nextUrl.pathname.startsWith("/admin") &&
      request.nextUrl.searchParams.get("admin_token")
    ) {
      const cleanUrl = request.nextUrl.clone()
      cleanUrl.searchParams.delete("admin_token")
      const response = NextResponse.redirect(cleanUrl)
      response.cookies.set(ADMIN_ACCESS_COOKIE, requiredAccessToken, {
        httpOnly: true,
        sameSite: "strict",
        secure: request.nextUrl.protocol === "https:",
        path: "/",
      })
      return response
    }

    return NextResponse.next()
  }

  const failedAttempt = consumeRateLimit(
    failedAuthLimiter,
    authAttemptKey,
    FAILED_AUTH_LIMIT,
    FAILED_AUTH_WINDOW_MS
  )
  if (!failedAttempt.allowed) {
    return tooManyRequestsResponse(failedAttempt.resetAt)
  }

  return unauthorizedResponse(request)
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
}
