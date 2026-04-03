import { NextResponse } from "next/server"
import { isDatabaseConfigured } from "@/lib/server/db"
import { requireVerifiedWalletSession } from "@/lib/server/wallet-session"
import { isValidWalletAccount } from "@/lib/server/watchlist-store"
import { createUserAlert, listUserAlerts } from "@/lib/server/alert-store"
import { getTwinDetailResult } from "@/lib/services/market/detail"
import type { AlertConditionType, CreateUserAlertInput } from "@/lib/types"

const VALID_ALERT_CONDITIONS = new Set<AlertConditionType>([
  "price_above",
  "price_below",
  "volume_spike_pct",
  "holder_growth_pct",
])

function serviceUnavailable() {
  return NextResponse.json(
    { error: "Alert persistence requires DATABASE_URL to be configured." },
    { status: 503 }
  )
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function GET(request: Request) {
  if (!isDatabaseConfigured()) {
    return serviceUnavailable()
  }

  const url = new URL(request.url)
  const account = url.searchParams.get("account")?.trim() ?? ""
  if (!isValidWalletAccount(account)) {
    return badRequest("A valid wallet account is required.")
  }

  const sessionError = await requireVerifiedWalletSession(request, account)
  if (sessionError) {
    return sessionError
  }

  const alerts = await listUserAlerts(account)
  return NextResponse.json({ alerts }, { headers: { "Cache-Control": "no-store" } })
}

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) {
    return serviceUnavailable()
  }

  const body = (await request.json().catch(() => null)) as CreateUserAlertInput | null
  const account = body?.account?.trim() ?? ""
  const twinId = body?.twinId?.trim() ?? ""
  const label = body?.label?.trim()
  const conditionType = body?.conditionType
  const threshold = Number(body?.threshold)
  const windowMinutes =
    body?.windowMinutes === null || body?.windowMinutes === undefined
      ? null
      : Number(body.windowMinutes)
  const note = body?.note?.trim()

  if (!isValidWalletAccount(account)) {
    return badRequest("A valid wallet account is required.")
  }
  const sessionError = await requireVerifiedWalletSession(request, account)
  if (sessionError) {
    return sessionError
  }
  if (!twinId) {
    return badRequest("Twin ID is required.")
  }
  if (!conditionType || !VALID_ALERT_CONDITIONS.has(conditionType)) {
    return badRequest("A valid alert condition type is required.")
  }
  if (!Number.isFinite(threshold) || threshold <= 0) {
    return badRequest("Alert threshold must be a positive number.")
  }
  if (windowMinutes !== null && (!Number.isInteger(windowMinutes) || windowMinutes <= 0)) {
    return badRequest("Window minutes must be a whole number greater than zero when provided.")
  }

  const twinResult = await getTwinDetailResult(twinId)
  if (!twinResult.twin && twinResult.unavailable) {
    return NextResponse.json(
      { error: twinResult.error ?? "Twin market data is temporarily unavailable." },
      { status: 503 }
    )
  }
  if (!twinResult.twin) {
    return NextResponse.json({ error: "Twin not found." }, { status: 404 })
  }

  const alert = await createUserAlert({
    account,
    twinId,
    conditionType,
    threshold,
    ...(typeof label === "string" && label ? { label } : {}),
    ...(windowMinutes !== null ? { windowMinutes } : {}),
    ...(typeof note === "string" && note ? { note } : {}),
  })

  return NextResponse.json({ alert }, { headers: { "Cache-Control": "no-store" } })
}
