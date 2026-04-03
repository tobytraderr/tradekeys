import "server-only"

import { getDb, isDatabaseConfigured } from "@/lib/server/db"
import { isValidWalletAccount } from "@/lib/server/watchlist-store"
import type {
  AlertConditionType,
  AlertStatus,
  CreateUserAlertInput,
  UpdateUserAlertInput,
  UserAlert,
} from "@/lib/types"

function normalizeAccount(account: string) {
  return account.trim().toLowerCase()
}

function rowToAlert(row: Record<string, unknown>): UserAlert {
  return {
    id: Number(row.id),
    account: String(row.account),
    twinId: String(row.twin_id),
    label: String(row.label),
    conditionType: String(row.condition_type) as AlertConditionType,
    threshold: Number(row.threshold),
    windowMinutes:
      row.window_minutes === null || row.window_minutes === undefined
        ? null
        : Number(row.window_minutes),
    status: String(row.status) as AlertStatus,
    ...(row.note ? { note: String(row.note) } : {}),
    ...(row.last_triggered_at
      ? { lastTriggeredAt: new Date(String(row.last_triggered_at)).toISOString() }
      : {}),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }
}

export async function initAlertSchema() {
  // Schema is owned by SQL migrations.
}

export async function listUserAlerts(account: string): Promise<UserAlert[]> {
  if (!isDatabaseConfigured() || !isValidWalletAccount(account)) return []
  await initAlertSchema()
  const db = getDb()
  const result = await db.query(
    `
    select *
    from user_alerts
    where account = $1
    order by updated_at desc, id desc
    `,
    [normalizeAccount(account)]
  )

  return result.rows.map((row) => rowToAlert(row))
}

export async function createUserAlert(input: CreateUserAlertInput): Promise<UserAlert> {
  if (!isDatabaseConfigured()) {
    throw new Error("DATABASE_URL is not configured.")
  }
  if (!isValidWalletAccount(input.account)) {
    throw new Error("A valid wallet account is required.")
  }

  await initAlertSchema()
  const db = getDb()
  const result = await db.query(
    `
    insert into user_alerts (
      account,
      twin_id,
      label,
      condition_type,
      threshold,
      window_minutes,
      note,
      status,
      updated_at
    ) values (
      $1, $2, $3, $4, $5, $6, $7, 'active', now()
    )
    returning *
    `,
    [
      normalizeAccount(input.account),
      input.twinId,
      input.label?.trim() || `${input.conditionType} alert`,
      input.conditionType,
      input.threshold,
      input.windowMinutes ?? null,
      input.note?.trim() || null,
    ]
  )

  return rowToAlert(result.rows[0])
}

export async function updateUserAlert(
  account: string,
  alertId: number,
  input: UpdateUserAlertInput
): Promise<UserAlert | null> {
  if (!isDatabaseConfigured()) {
    throw new Error("DATABASE_URL is not configured.")
  }
  if (!isValidWalletAccount(account)) {
    throw new Error("A valid wallet account is required.")
  }

  await initAlertSchema()
  const db = getDb()
  const result = await db.query(
    `
    update user_alerts
    set
      label = coalesce($3, label),
      threshold = coalesce($4, threshold),
      window_minutes = case
        when $5::boolean then null
        else coalesce($6, window_minutes)
      end,
      status = coalesce($7, status),
      note = case
        when $8::boolean then null
        else coalesce($9, note)
      end,
      updated_at = now()
    where account = $1 and id = $2
    returning *
    `,
    [
      normalizeAccount(account),
      alertId,
      input.label?.trim() || null,
      typeof input.threshold === "number" ? input.threshold : null,
      input.windowMinutes === null,
      typeof input.windowMinutes === "number" ? input.windowMinutes : null,
      input.status ?? null,
      input.note === "",
      input.note?.trim() || null,
    ]
  )

  return result.rows[0] ? rowToAlert(result.rows[0]) : null
}

export async function deleteUserAlert(account: string, alertId: number) {
  if (!isDatabaseConfigured()) {
    throw new Error("DATABASE_URL is not configured.")
  }
  if (!isValidWalletAccount(account)) {
    throw new Error("A valid wallet account is required.")
  }

  await initAlertSchema()
  const db = getDb()
  await db.query(
    `
    delete from user_alerts
    where account = $1 and id = $2
    `,
    [normalizeAccount(account), alertId]
  )
}
