import "server-only"

import crypto from "node:crypto"
import {
  getCopilotDailyPromptLimit,
  isCopilotDailyPromptLimitEnabled,
} from "@/lib/env"
import type { CopilotQuotaSnapshot } from "@/lib/types"
import { getDb, isDatabaseConfigured } from "@/lib/server/db"
import { getRequestIp } from "@/lib/server/request-ip"
import { isValidWalletAccount } from "@/lib/server/watchlist-store"

type UsageIdentity = {
  scope: "wallet" | "guest"
  usageKey: string
}

type MemoryEntry = {
  count: number
  day: string
}

export type CopilotQuotaConsumption = {
  allowed: boolean
  quota: CopilotQuotaSnapshot
}

const globalState = globalThis as typeof globalThis & {
  __tradekeysCopilotQuotaMemory?: Map<string, MemoryEntry>
}

const memoryStore =
  globalState.__tradekeysCopilotQuotaMemory ??
  (globalState.__tradekeysCopilotQuotaMemory = new Map<string, MemoryEntry>())

function getQuotaDay() {
  return new Date().toISOString().slice(0, 10)
}

function getQuotaResetIso() {
  const now = new Date()
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  return reset.toISOString()
}

function buildUsageIdentity(request: Request, account?: string | null): UsageIdentity {
  if (account && isValidWalletAccount(account)) {
    const normalized = account.toLowerCase()
    return {
      scope: "wallet",
      usageKey: crypto.createHash("sha256").update(`wallet:${normalized}`).digest("hex"),
    }
  }

  const clientIp = getRequestIp(request)
  return {
    scope: "guest",
    usageKey: crypto.createHash("sha256").update(`ip:${clientIp}`).digest("hex"),
  }
}

function buildSnapshot(input: {
  enabled: boolean
  scope: "wallet" | "guest"
  used: number
}) {
  const limit = getCopilotDailyPromptLimit()
  const used = Math.max(0, input.used)
  const remaining = input.enabled ? Math.max(0, limit - used) : null

  const snapshot: CopilotQuotaSnapshot = {
    enabled: input.enabled,
    scope: input.scope,
    used,
    limit: input.enabled ? limit : null,
    remaining,
    exhausted: input.enabled ? used >= limit : false,
    resetAt: getQuotaResetIso(),
  }

  return snapshot
}

async function getUsedCountFromDb(identity: UsageIdentity) {
  const db = getDb()
  const result = await db.query(
    `
    select prompt_count::int as prompt_count
    from copilot_daily_usage
    where usage_key = $1 and usage_day = $2::date
    `,
    [identity.usageKey, getQuotaDay()]
  )

  return Number(result.rows[0]?.prompt_count ?? 0)
}

function getUsedCountFromMemory(identity: UsageIdentity) {
  const entry = memoryStore.get(identity.usageKey)
  if (!entry || entry.day !== getQuotaDay()) {
    return 0
  }
  return entry.count
}

function consumeFromMemory(identity: UsageIdentity): CopilotQuotaConsumption {
  const day = getQuotaDay()
  const limit = getCopilotDailyPromptLimit()
  const current = memoryStore.get(identity.usageKey)
  const nextCount = !current || current.day !== day ? 1 : current.count + 1

  if (nextCount > limit) {
    return {
      allowed: false,
      quota: buildSnapshot({
        enabled: true,
        scope: identity.scope,
        used: current?.day === day ? current.count : limit,
      }),
    }
  }

  memoryStore.set(identity.usageKey, { day, count: nextCount })
  return {
    allowed: true,
    quota: buildSnapshot({
      enabled: true,
      scope: identity.scope,
      used: nextCount,
    }),
  }
}

export async function getCopilotQuotaSnapshot(input: {
  request: Request
  account?: string | null
}): Promise<CopilotQuotaSnapshot> {
  const enabled = isCopilotDailyPromptLimitEnabled()
  const identity = buildUsageIdentity(input.request, input.account)

  if (!enabled) {
    return buildSnapshot({
      enabled: false,
      scope: identity.scope,
      used: 0,
    })
  }

  const used = isDatabaseConfigured()
    ? await getUsedCountFromDb(identity)
    : getUsedCountFromMemory(identity)

  return buildSnapshot({
    enabled: true,
    scope: identity.scope,
    used,
  })
}

export async function consumeCopilotQuota(input: {
  request: Request
  account?: string | null
}): Promise<CopilotQuotaConsumption> {
  const enabled = isCopilotDailyPromptLimitEnabled()
  const identity = buildUsageIdentity(input.request, input.account)

  if (!enabled) {
    return {
      allowed: true,
      quota: buildSnapshot({
        enabled: false,
        scope: identity.scope,
        used: 0,
      }),
    }
  }

  if (!isDatabaseConfigured()) {
    return consumeFromMemory(identity)
  }

  const db = getDb()
  const day = getQuotaDay()
  const limit = getCopilotDailyPromptLimit()
  const result = await db.query(
    `
    insert into copilot_daily_usage (usage_key, usage_day, prompt_count, last_prompt_at)
    values ($1, $2::date, 1, now())
    on conflict (usage_key, usage_day) do update
      set prompt_count = copilot_daily_usage.prompt_count + 1,
          last_prompt_at = now()
      where copilot_daily_usage.prompt_count < $3
    returning prompt_count::int as prompt_count
    `,
    [identity.usageKey, day, limit]
  )

  if (result.rowCount && result.rows[0]?.prompt_count) {
    return {
      allowed: true,
      quota: buildSnapshot({
        enabled: true,
        scope: identity.scope,
        used: Number(result.rows[0].prompt_count),
      }),
    }
  }

  const used = await getUsedCountFromDb(identity)
  return {
    allowed: false,
    quota: buildSnapshot({
      enabled: true,
      scope: identity.scope,
      used,
    }),
  }
}
