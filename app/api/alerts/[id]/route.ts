import { NextResponse } from "next/server"
import { deleteUserAlert, updateUserAlert } from "@/lib/server/alert-store"
import { isDatabaseConfigured } from "@/lib/server/db"
import { requireVerifiedWalletSession } from "@/lib/server/wallet-session"
import { isValidWalletAccount } from "@/lib/server/watchlist-store"
import type { AlertStatus, UpdateUserAlertInput } from "@/lib/types"

const VALID_STATUSES = new Set<AlertStatus>(["active", "paused", "triggered", "archived"])

function serviceUnavailable() {
  return NextResponse.json(
    { error: "Alert persistence requires DATABASE_URL to be configured." },
    { status: 503 }
  )
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

function parseAlertId(value: string) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!isDatabaseConfigured()) {
    return serviceUnavailable()
  }

  const { id } = await context.params
  const alertId = parseAlertId(id)
  if (!alertId) {
    return badRequest("A valid alert ID is required.")
  }

  const body = (await request.json().catch(() => null)) as
    | ({ account?: string } & UpdateUserAlertInput)
    | null
  const account = body?.account?.trim() ?? ""

  if (!isValidWalletAccount(account)) {
    return badRequest("A valid wallet account is required.")
  }

  const sessionError = await requireVerifiedWalletSession(request, account)
  if (sessionError) {
    return sessionError
  }

  const patch: UpdateUserAlertInput = {}
  if (typeof body?.label === "string") {
    patch.label = body.label
  }
  if (typeof body?.threshold !== "undefined") {
    const threshold = Number(body.threshold)
    if (!Number.isFinite(threshold) || threshold <= 0) {
      return badRequest("Alert threshold must be a positive number.")
    }
    patch.threshold = threshold
  }
  if (typeof body?.windowMinutes !== "undefined") {
    if (body.windowMinutes === null) {
      patch.windowMinutes = null
    } else {
      const windowMinutes = Number(body.windowMinutes)
      if (!Number.isInteger(windowMinutes) || windowMinutes <= 0) {
        return badRequest("Window minutes must be a whole number greater than zero.")
      }
      patch.windowMinutes = windowMinutes
    }
  }
  if (typeof body?.status !== "undefined") {
    if (!VALID_STATUSES.has(body.status)) {
      return badRequest("A valid alert status is required.")
    }
    patch.status = body.status
  }
  if (typeof body?.note === "string") {
    patch.note = body.note
  }

  const alert = await updateUserAlert(account, alertId, patch)
  if (!alert) {
    return NextResponse.json({ error: "Alert not found." }, { status: 404 })
  }

  return NextResponse.json({ alert }, { headers: { "Cache-Control": "no-store" } })
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!isDatabaseConfigured()) {
    return serviceUnavailable()
  }

  const { id } = await context.params
  const alertId = parseAlertId(id)
  if (!alertId) {
    return badRequest("A valid alert ID is required.")
  }

  const body = (await request.json().catch(() => null)) as { account?: string } | null
  const account = body?.account?.trim() ?? ""
  if (!isValidWalletAccount(account)) {
    return badRequest("A valid wallet account is required.")
  }

  const sessionError = await requireVerifiedWalletSession(request, account)
  if (sessionError) {
    return sessionError
  }

  await deleteUserAlert(account, alertId)
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } })
}
