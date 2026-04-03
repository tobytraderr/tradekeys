import "server-only"

import { getDb, isDatabaseConfigured } from "@/lib/server/db"

function normalizeAccount(account: string) {
  return account.trim().toLowerCase()
}

export function isValidWalletAccount(account: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(account.trim())
}

export async function initWatchlistSchema() {
  // Schema is owned by SQL migrations.
}

export async function listWatchlistTwinIds(account: string): Promise<string[]> {
  if (!isDatabaseConfigured()) return []
  await initWatchlistSchema()
  const db = getDb()
  const result = await db.query(
    `
    select twin_id
    from user_watchlists
    where account = $1
    order by created_at desc
    `,
    [normalizeAccount(account)]
  )
  return result.rows.map((row) => String(row.twin_id))
}

export async function addWatchlistTwin(account: string, twinId: string) {
  if (!isDatabaseConfigured()) {
    throw new Error("DATABASE_URL is not configured.")
  }
  await initWatchlistSchema()
  const db = getDb()
  await db.query(
    `
    insert into user_watchlists (account, twin_id, updated_at)
    values ($1, $2, now())
    on conflict (account, twin_id) do update set
      updated_at = now()
    `,
    [normalizeAccount(account), twinId]
  )
}

export async function removeWatchlistTwin(account: string, twinId: string) {
  if (!isDatabaseConfigured()) {
    throw new Error("DATABASE_URL is not configured.")
  }
  await initWatchlistSchema()
  const db = getDb()
  await db.query(
    `
    delete from user_watchlists
    where account = $1 and twin_id = $2
    `,
    [normalizeAccount(account), twinId]
  )
}
