import "server-only"

import { formatEther, createPublicClient, http } from "viem"
import { bsc } from "viem/chains"
import contractAbi from "@/lib/contracts/abis/DigitalTwinSharesV1.json"
import networks from "@/lib/contracts/networks.json"
import { convertBnbToUsd } from "@/lib/currency"
import { getBscRpcUrl } from "@/lib/env"
import { fetchJsonWithRetry } from "@/lib/server/fetch-utils"
import {
  recordOpsEvent,
  recordQuoteFailure,
  recordQuoteSuccess,
  recordUpstreamFailure,
  withOpsTrace,
} from "@/lib/server/ops-observability"
import type { TwinCreationQuote } from "@/lib/types"

const contractAddress = networks.bsc.DigitalTwinSharesV1.address as `0x${string}`
const BNB_USD_CACHE_TTL_MS = 60_000
const BNB_USD_STALE_TTL_MS = 10 * 60_000
const BNB_USD_INITIAL_BACKOFF_MS = 30_000
const BNB_USD_MAX_BACKOFF_MS = 5 * 60_000
const RPC_CALL_TIMEOUT_MS = 10_000
const RPC_RETRY_ATTEMPTS = 3
const RPC_RETRY_BASE_MS = 500

export type PriceResult = {
  price: number | null
  source: "live" | "cache" | "stale" | "unavailable"
  asOf: number | null
  stale: boolean
}

type BnbUsdCacheState = {
  lastGoodPrice: number | null
  lastGoodAt: number | null
  expiresAt: number | null
  staleUntil: number | null
  inFlight: Promise<PriceResult> | null
  backoffUntil: number | null
  consecutiveFailures: number
  lastError: string | null
}

const bnbUsdCacheState: BnbUsdCacheState = {
  lastGoodPrice: null,
  lastGoodAt: null,
  expiresAt: null,
  staleUntil: null,
  inFlight: null,
  backoffUntil: null,
  consecutiveFailures: 0,
  lastError: null,
}

function getClient() {
  const rpcUrl = getBscRpcUrl()
  if (!rpcUrl) {
    return null
  }
  return createPublicClient({
    chain: bsc,
    transport: http(rpcUrl, {
      timeout: RPC_CALL_TIMEOUT_MS,
      retryCount: 2,
      retryDelay: RPC_RETRY_BASE_MS,
    }),
  })
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withRpcTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`${label} timed out`))
        }, RPC_CALL_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
    }
  }
}

async function retryRpcCall<T>(label: string, task: () => Promise<T>): Promise<T> {
  let lastError: unknown = null

  for (let attempt = 1; attempt <= RPC_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await task()
    } catch (error) {
      lastError = error
      recordUpstreamFailure({
        dependency: "rpc",
        operation: label,
        error,
        data: { attempt },
      })
      if (attempt === RPC_RETRY_ATTEMPTS) {
        throw error
      }
      await sleep(Math.min(RPC_RETRY_BASE_MS * 2 ** (attempt - 1), 2_000))
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${label} failed`)
}

async function readContractWithRetry<T>(
  client: NonNullable<ReturnType<typeof getClient>>,
  label: string,
  request: Parameters<typeof client.readContract>[0]
) {
  return retryRpcCall(label, () => withRpcTimeout(client.readContract(request) as Promise<T>, label))
}

async function readBalanceWithRetry(
  client: NonNullable<ReturnType<typeof getClient>>,
  address: `0x${string}`
) {
  return retryRpcCall("getBalance", () => withRpcTimeout(client.getBalance({ address }), "getBalance"))
}

export async function fetchLiveTwinQuote(twinId: string, amount = 1n, wallet?: `0x${string}`) {
  return withOpsTrace({
    name: "trade_quote_generation",
    dependency: "rpc",
    data: { twinId, amount: amount.toString() },
    task: async () => {
      const client = getClient()
      if (!client) {
        recordQuoteFailure({
          path: "fetchLiveTwinQuote",
          twinId,
          error: new Error("BSC RPC client unavailable."),
        })
        return null
      }

      const usdPerBnb = await fetchBnbUsdPrice().catch(() => null)

      const [buyQuoteResult, sellQuoteResult, supplyResult, subjectFeeResult, holderBalanceResult] =
        await Promise.allSettled([
          readContractWithRetry<bigint>(client, "getBuyPriceAfterFee", {
            address: contractAddress,
            abi: contractAbi,
            functionName: "getBuyPriceAfterFee",
            args: [twinId as `0x${string}`, amount],
          }),
          readContractWithRetry<bigint>(client, "getSellPriceAfterFee", {
            address: contractAddress,
            abi: contractAbi,
            functionName: "getSellPriceAfterFee",
            args: [twinId as `0x${string}`, amount],
          }),
          readContractWithRetry<bigint>(client, "sharesSupply", {
            address: contractAddress,
            abi: contractAbi,
            functionName: "sharesSupply",
            args: [twinId as `0x${string}`],
          }),
          readContractWithRetry<bigint>(client, "subjectFeePercent", {
            address: contractAddress,
            abi: contractAbi,
            functionName: "subjectFeePercent",
          }),
          wallet
            ? readContractWithRetry<bigint>(client, "sharesBalance", {
                address: contractAddress,
                abi: contractAbi,
                functionName: "sharesBalance",
                args: [twinId as `0x${string}`, wallet],
              })
            : Promise.resolve(0n),
        ])

      if (buyQuoteResult.status !== "fulfilled") {
        recordQuoteFailure({
          path: "fetchLiveTwinQuote",
          twinId,
          error: buyQuoteResult.reason,
        })
        return null
      }

      if (sellQuoteResult.status !== "fulfilled") {
        recordOpsEvent({
          level: "warn",
          category: "quote",
          name: "fetchLiveTwinQuote.sell_partial_failure",
          message:
            sellQuoteResult.reason instanceof Error
              ? sellQuoteResult.reason.message
              : "Sell quote unavailable.",
          dependency: "rpc",
          data: { twinId },
        })
      }

      const buyWei = buyQuoteResult.value as bigint
      const sellWei = sellQuoteResult.status === "fulfilled" ? (sellQuoteResult.value as bigint) : 0n
      const supplyValue = supplyResult.status === "fulfilled" ? (supplyResult.value as bigint) : 0n
      const subjectFeeValue =
        subjectFeeResult.status === "fulfilled" ? (subjectFeeResult.value as bigint) : 0n
      const holderBalanceValue =
        holderBalanceResult.status === "fulfilled" ? (holderBalanceResult.value as bigint) : 0n

      recordQuoteSuccess({
        path: "fetchLiveTwinQuote",
        twinId,
      })

      return {
        twinId,
        amount: amount.toString(),
        buyQuoteWei: buyWei.toString(),
        sellQuoteWei: sellWei.toString(),
        buyQuoteEth: formatEther(buyWei),
        sellQuoteEth: formatEther(sellWei),
        buyQuoteUsd:
          typeof usdPerBnb === "number"
            ? convertBnbToUsd(Number(formatEther(buyWei)), usdPerBnb).toFixed(2)
            : "0.00",
        sellQuoteUsd:
          typeof usdPerBnb === "number"
            ? convertBnbToUsd(Number(formatEther(sellWei)), usdPerBnb).toFixed(2)
            : "0.00",
        feeSharePct: (Number(subjectFeeValue) / 1e16).toFixed(2),
        supply: supplyValue.toString(),
        holderBalanceWei: wallet ? holderBalanceValue.toString() : undefined,
        holderBalance: wallet ? holderBalanceValue.toString() : undefined,
      }
    },
  })
}

export async function fetchTwinCreationQuote(
  twinId: string
): Promise<TwinCreationQuote | null> {
  const client = getClient()
  if (!client) {
    return null
  }

  const [existsValue, ownerValue, minSharesValue, usdPerBnb] = await Promise.all([
    readContractWithRetry<boolean>(client, "digitalTwinExists", {
      address: contractAddress,
      abi: contractAbi,
      functionName: "digitalTwinExists",
      args: [twinId as `0x${string}`],
    }),
    readContractWithRetry<`0x${string}`>(client, "digitalTwinIdToOwner", {
      address: contractAddress,
      abi: contractAbi,
      functionName: "digitalTwinIdToOwner",
      args: [twinId as `0x${string}`],
    }),
    readContractWithRetry<bigint>(client, "minSharesToCreate", {
      address: contractAddress,
      abi: contractAbi,
      functionName: "minSharesToCreate",
    }),
    fetchBnbUsdPrice().catch(() => null),
  ])

  const minShares = minSharesValue as bigint
  const requiredValue = (await readContractWithRetry<bigint>(client, "getBuyPriceAfterFee", {
    address: contractAddress,
    abi: contractAbi,
    functionName: "getBuyPriceAfterFee",
    args: [twinId as `0x${string}`, minShares],
  })) as bigint

  const owner = String(ownerValue)
  const zeroAddress = "0x0000000000000000000000000000000000000000"

  return {
    twinId,
    exists: Boolean(existsValue),
    owner,
    isClaimed: owner.toLowerCase() !== zeroAddress,
    minSharesToCreate: minShares.toString(),
    requiredValueWei: requiredValue.toString(),
    requiredValueBnb: formatEther(requiredValue),
    requiredValueUsd:
      typeof usdPerBnb === "number"
        ? convertBnbToUsd(Number(formatEther(requiredValue)), usdPerBnb).toFixed(2)
        : "0.00",
  }
}

export async function fetchLiveTwinOwnerAndUrl(twinId: string) {
  const client = getClient()
  if (!client) {
    return null
  }

  const [owner, url, supply] = await Promise.all([
    readContractWithRetry<`0x${string}`>(client, "digitalTwinIdToOwner", {
      address: contractAddress,
      abi: contractAbi,
      functionName: "digitalTwinIdToOwner",
      args: [twinId as `0x${string}`],
    }),
    readContractWithRetry<string>(client, "digitalTwinUrl", {
      address: contractAddress,
      abi: contractAbi,
      functionName: "digitalTwinUrl",
      args: [twinId as `0x${string}`],
    }),
    readContractWithRetry<bigint>(client, "sharesSupply", {
      address: contractAddress,
      abi: contractAbi,
      functionName: "sharesSupply",
      args: [twinId as `0x${string}`],
    }),
  ])

  return {
    owner: String(owner),
    url: String(url),
    supply: String(supply),
  }
}

export async function fetchAddressNativeBalance(address: `0x${string}`) {
  const client = getClient()
  if (!client) {
    return null
  }

  const balance = await readBalanceWithRetry(client, address)
  return {
    wei: balance.toString(),
    bnb: Number(formatEther(balance)),
  }
}

function buildPriceResult(
  price: number | null,
  source: PriceResult["source"],
  asOf: number | null,
  stale: boolean
): PriceResult {
  return {
    price,
    source,
    asOf,
    stale,
  }
}

function getCachedPriceResult(now = Date.now()): PriceResult | null {
  if (
    typeof bnbUsdCacheState.lastGoodPrice === "number" &&
    bnbUsdCacheState.expiresAt &&
    now < bnbUsdCacheState.expiresAt
  ) {
    return buildPriceResult(
      bnbUsdCacheState.lastGoodPrice,
      "cache",
      bnbUsdCacheState.lastGoodAt,
      false
    )
  }

  return null
}

function getStalePriceResult(now = Date.now()): PriceResult | null {
  if (
    typeof bnbUsdCacheState.lastGoodPrice === "number" &&
    bnbUsdCacheState.staleUntil &&
    now < bnbUsdCacheState.staleUntil
  ) {
    return buildPriceResult(
      bnbUsdCacheState.lastGoodPrice,
      "stale",
      bnbUsdCacheState.lastGoodAt,
      true
    )
  }

  return null
}

function computeBackoffMs(failureCount: number) {
  const multiplier = Math.max(0, failureCount - 1)
  return Math.min(BNB_USD_INITIAL_BACKOFF_MS * 2 ** multiplier, BNB_USD_MAX_BACKOFF_MS)
}

function recordPriceFetchSuccess(price: number, now = Date.now()) {
  bnbUsdCacheState.lastGoodPrice = price
  bnbUsdCacheState.lastGoodAt = now
  bnbUsdCacheState.expiresAt = now + BNB_USD_CACHE_TTL_MS
  bnbUsdCacheState.staleUntil = now + BNB_USD_STALE_TTL_MS
  bnbUsdCacheState.backoffUntil = null
  bnbUsdCacheState.consecutiveFailures = 0
  bnbUsdCacheState.lastError = null
}

function recordPriceFetchFailure(error: unknown, now = Date.now()) {
  const nextFailureCount = bnbUsdCacheState.consecutiveFailures + 1
  const message = error instanceof Error ? error.message : String(error ?? "Unknown price fetch error")

  bnbUsdCacheState.consecutiveFailures = nextFailureCount
  bnbUsdCacheState.lastError = message
  bnbUsdCacheState.backoffUntil = now + computeBackoffMs(nextFailureCount)

  if (bnbUsdCacheState.lastGoodAt) {
    bnbUsdCacheState.staleUntil = Math.max(
      bnbUsdCacheState.staleUntil ?? 0,
      bnbUsdCacheState.lastGoodAt + BNB_USD_STALE_TTL_MS
    )
  }

  recordUpstreamFailure({
    dependency: "coingecko",
    operation: "bnb_usd_price",
    error,
  })
}

async function fetchLiveBnbUsdPrice(): Promise<PriceResult> {
  const payload = await fetchJsonWithRetry<{
    binancecoin?: {
      usd?: number
    }
  }>(
    "https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd",
    {
      headers: { Accept: "application/json" },
      cache: "no-store",
    },
    {
      attempts: 3,
      timeoutMs: 8_000,
      initialBackoffMs: 500,
      maxBackoffMs: 4_000,
      dependency: "coingecko",
      operation: "bnb_usd_price",
    }
  )

  const price = payload.binancecoin?.usd
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    throw new Error("BNB/USD price unavailable")
  }

  const now = Date.now()
  recordPriceFetchSuccess(price, now)
  return buildPriceResult(price, "live", now, false)
}

export async function getBnbUsdPriceSafe(): Promise<PriceResult> {
  const now = Date.now()
  const fresh = getCachedPriceResult(now)
  if (fresh) {
    return fresh
  }

  if (bnbUsdCacheState.inFlight) {
    return bnbUsdCacheState.inFlight
  }

  if (bnbUsdCacheState.backoffUntil && now < bnbUsdCacheState.backoffUntil) {
    return getStalePriceResult(now) ?? buildPriceResult(null, "unavailable", null, false)
  }

  const inFlight = (async () => {
    try {
      return await fetchLiveBnbUsdPrice()
    } catch (error) {
      recordPriceFetchFailure(error)
      return getStalePriceResult() ?? buildPriceResult(null, "unavailable", null, false)
    } finally {
      bnbUsdCacheState.inFlight = null
    }
  })()

  bnbUsdCacheState.inFlight = inFlight
  return inFlight
}

export async function fetchBnbUsdPrice(): Promise<number | null> {
  const result = await getBnbUsdPriceSafe()
  return result.price
}
