import "server-only"

import { getMetadataFetchAllowedHosts } from "@/lib/env"
import { recordQuoteFailure, recordQuoteSuccess, withOpsTrace } from "@/lib/server/ops-observability"
import { normalizeSafeRemoteUrl } from "@/lib/server/remote-resource"
import { isValidWalletAccount } from "@/lib/server/watchlist-store"
import { fetchTwinCreationQuote } from "@/lib/server/rpc"
import { getTwinQuote } from "@/lib/services/market/pricing"
import type { TwinCreationQuote, TwinQuote } from "@/lib/types"

export const EXECUTION_QUOTE_TTL_MS = 20_000

export type ExecutionAction = "buy" | "sell"

export function isValidTwinId(value: string) {
  return /^0x[a-fA-F0-9]{32}$/.test(value.trim())
}

export function normalizeTwinId(value: string) {
  return value.trim().toLowerCase()
}

export function normalizeWallet(value: string | null | undefined) {
  const normalized = value?.trim() ?? ""
  if (!normalized) return undefined
  if (!isValidWalletAccount(normalized)) {
    throw new Error("A valid wallet account is required.")
  }
  return normalized as `0x${string}`
}

export function parsePositiveAmount(value: string | number | bigint) {
  let amount = 0n
  try {
    amount = BigInt(value)
  } catch {
    throw new Error("Amount must be an integer.")
  }

  if (amount <= 0n) {
    throw new Error("Amount must be greater than zero.")
  }

  return amount
}

export async function normalizeMetadataUrl(value: string) {
  const parsed = await normalizeSafeRemoteUrl(value, {
    label: "Metadata URL",
    allowHttp: true,
    allowedHosts: getMetadataFetchAllowedHosts(),
  })
  return parsed.toString()
}

function withExecutionMetadata<T extends TwinQuote | TwinCreationQuote>(quote: T): T {
  const quotedAt = new Date()
  const expiresAt = new Date(quotedAt.getTime() + EXECUTION_QUOTE_TTL_MS)

  return {
    ...quote,
    quotedAt: quotedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    displayValuesAreIndicative: true,
  }
}

export async function getExecutionQuote(input: {
  twinId: string
  amount: bigint
  wallet?: `0x${string}`
}) {
  return withOpsTrace({
    name: "execution_quote",
    dependency: "rpc",
    data: { twinId: input.twinId, amount: input.amount.toString() },
    task: async () => {
      const twinId = normalizeTwinId(input.twinId)
      if (!isValidTwinId(twinId)) {
        throw new Error("Twin ID must be a 0x-prefixed bytes16 value.")
      }

      const quote = await getTwinQuote(twinId, input.amount, input.wallet)
      if (!quote) {
        recordQuoteFailure({
          path: "execution_quote",
          twinId,
          error: new Error("Quote unavailable."),
        })
        throw new Error("Quote unavailable.")
      }

      recordQuoteSuccess({
        path: "execution_quote",
        twinId,
      })
      return withExecutionMetadata(quote)
    },
  })
}

export async function validateExecutionPreflight(input: {
  action: ExecutionAction
  twinId: string
  amount: bigint
  wallet?: `0x${string}`
}) {
  if (input.action === "sell" && !input.wallet) {
    throw new Error("A connected wallet is required to validate sell execution.")
  }

  const quote = await getExecutionQuote(input)

  if (input.action === "buy" && BigInt(quote.buyQuoteWei) <= 0n) {
    throw new Error("Buy quote unavailable.")
  }

  if (input.action === "sell") {
    if (BigInt(quote.sellQuoteWei) <= 0n) {
      throw new Error("Sell quote unavailable.")
    }

    const holderBalance = BigInt(quote.holderBalanceWei ?? quote.holderBalance ?? "0")
    if (holderBalance < input.amount) {
      throw new Error("Wallet balance is too low for this sell amount.")
    }
  }

  return {
    action: input.action,
    twinId: normalizeTwinId(input.twinId),
    amount: input.amount.toString(),
    quote,
  }
}

export async function getCreateTwinQuote(twinId: string) {
  return withOpsTrace({
    name: "create_twin_quote",
    dependency: "rpc",
    data: { twinId },
    task: async () => {
      const normalizedTwinId = normalizeTwinId(twinId)
      if (!isValidTwinId(normalizedTwinId)) {
        throw new Error("Twin ID must be a 0x-prefixed bytes16 value.")
      }

      const quote = await fetchTwinCreationQuote(normalizedTwinId)
      if (!quote) {
        recordQuoteFailure({
          path: "create_twin_quote",
          twinId: normalizedTwinId,
          error: new Error("Creation quote unavailable."),
        })
        throw new Error("Creation quote unavailable.")
      }

      recordQuoteSuccess({
        path: "create_twin_quote",
        twinId: normalizedTwinId,
      })
      return withExecutionMetadata(quote)
    },
  })
}

export async function validateCreateTwinPreflight(input: {
  twinId: string
  metadataUrl: string
  account?: string
}) {
  const twinId = normalizeTwinId(input.twinId)
  const metadataUrl = await normalizeMetadataUrl(input.metadataUrl)
  const account = input.account ? normalizeWallet(input.account) : undefined
  const quote = await getCreateTwinQuote(twinId)

  if (quote.exists) {
    throw new Error("Twin already exists.")
  }

  if (quote.isClaimed && account && quote.owner.toLowerCase() !== account.toLowerCase()) {
    throw new Error("Twin is already claimed by another owner.")
  }

  return {
    twinId,
    metadataUrl,
    account: account ?? null,
    quote,
  }
}
