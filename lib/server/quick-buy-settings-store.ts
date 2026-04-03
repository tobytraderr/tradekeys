import "server-only"

import { getDb, isDatabaseConfigured } from "@/lib/server/db"
import { isValidWalletAccount } from "@/lib/server/watchlist-store"

function normalizeAccount(account: string) {
  return account.trim().toLowerCase()
}

export async function initQuickBuySettingsSchema() {
  // Schema is owned by SQL migrations.
}

export async function getQuickBuyAmount(account: string): Promise<number | null> {
  if (!isDatabaseConfigured() || !isValidWalletAccount(account)) return null
  await initQuickBuySettingsSchema()
  const db = getDb()
  const result = await db.query(
    `
    select quick_buy_amount
    from user_trade_preferences
    where account = $1
    `,
    [normalizeAccount(account)]
  )

  const value = result.rows[0]?.quick_buy_amount
  return typeof value === "number" ? value : value ? Number(value) : null
}

export async function setQuickBuyAmount(account: string, quickBuyAmount: number | null) {
  if (!isDatabaseConfigured()) {
    throw new Error("DATABASE_URL is not configured.")
  }
  if (!isValidWalletAccount(account)) {
    throw new Error("A valid wallet account is required.")
  }

  await initQuickBuySettingsSchema()
  const db = getDb()
  await db.query(
    `
    insert into user_trade_preferences (account, quick_buy_amount, updated_at)
    values ($1, $2, now())
    on conflict (account) do update set
      quick_buy_amount = excluded.quick_buy_amount,
      updated_at = now()
    `,
    [normalizeAccount(account), quickBuyAmount]
  )
}
