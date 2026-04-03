import "server-only"

import { getSubgraphUrl } from "@/lib/env"
import { fetchWithRetry } from "@/lib/server/fetch-utils"

type GraphResponse<T> = {
  data?: T
  errors?: Array<{ message: string }>
}

const HOME_QUERY = `
query HomepageOverview($trendingFirst: Int!, $newFirst: Int!, $activeFirst: Int!) {
  protocolStats(id: "protocol") {
    totalTwins
  }
  recentTrades: trades(
    first: 20
    orderBy: blockTimestamp
    orderDirection: desc
  ) {
    id
    trader
    isBuy
    shareAmount
    ethAmount
    blockTimestamp
    digitalTwin {
      id
      url
    }
  }
  trendingTwins: digitalTwins(
    first: $trendingFirst
    orderBy: totalVolumeEth
    orderDirection: desc
    where: { totalTrades_gt: "0" }
  ) {
    id
    url
    owner
    supply
    createdAt
    totalTrades
    totalVolumeEth
    uniqueHolders
    activeHolders
    lastTradeAt
    lastTradeIsBuy
    lastTradeEthAmount
    lastTradeShareAmount
  }
  newTwins: digitalTwins(
    first: $newFirst
    orderBy: createdAt
    orderDirection: desc
  ) {
    id
    url
    owner
    supply
    createdAt
    totalTrades
    totalVolumeEth
    uniqueHolders
    activeHolders
    lastTradeAt
    lastTradeIsBuy
    lastTradeEthAmount
    lastTradeShareAmount
  }
  recentlyActiveTwins: digitalTwins(
    first: $activeFirst
    orderBy: lastTradeAt
    orderDirection: desc
    where: { totalTrades_gt: "0" }
  ) {
    id
    url
    owner
    supply
    createdAt
    totalTrades
    totalVolumeEth
    uniqueHolders
    activeHolders
    lastTradeAt
    lastTrader
    lastTradeIsBuy
    lastTradeEthAmount
    lastTradeShareAmount
  }
}`

const MOMENTUM_SNAPSHOTS_QUERY = `
query MomentumSnapshots($ids: [Bytes!], $first: Int!) {
  hourlySnapshots: twinSnapshotHourlies(
    first: $first
    orderBy: bucketStart
    orderDirection: desc
    where: { digitalTwin_in: $ids }
  ) {
    id
    bucketStart
    volumeEth
    openPriceEth
    closePriceEth
    activeHolders
    digitalTwin {
      id
    }
  }
}`

const TWIN_DETAIL_QUERY = `
query TwinDetailPage(
  $id: Bytes!
  $tradesFirst: Int!
  $holdersFirst: Int!
  $hourlyFirst: Int!
) {
  digitalTwin(id: $id) {
    id
    url
    owner
    supply
    createdAt
    updatedAt
    totalTrades
    buyTrades
    sellTrades
    totalVolumeEth
    uniqueHolders
    activeHolders
    lastTradeAt
    lastTradeEthAmount
    lastTradeShareAmount
    trades(first: $tradesFirst, orderBy: blockTimestamp, orderDirection: desc) {
      id
      txHash
      trader
      isBuy
      shareAmount
      ethAmount
      protocolEthAmount
      subjectEthAmount
      supply
      pricePerShareEth
      blockNumber
      blockTimestamp
    }
    holders(first: $holdersFirst, orderBy: balance, orderDirection: desc) {
      id
      holder
      balance
      firstSeenAt
      lastTradeAt
      tradeCount
      isActive
      totalBoughtShares
      totalSoldShares
      totalBoughtEth
      totalSoldEth
    }
  }
  hourlySnapshots: twinSnapshotHourlies(
    first: $hourlyFirst
    orderBy: bucketStart
    orderDirection: desc
    where: { digitalTwin: $id }
  ) {
    id
    bucketStart
    trades
    volumeEth
    openPriceEth
    highPriceEth
    lowPriceEth
    closePriceEth
    closeSupply
    activeHolders
  }
}`

const PORTFOLIO_TWIN_HOLDERS_QUERY = `
query PortfolioTwinHolders($holder: Bytes!, $first: Int!) {
  twinHolders(
    first: $first
    orderBy: balance
    orderDirection: desc
    where: { holder: $holder, balance_gt: "0" }
  ) {
    id
    holder
    balance
    firstSeenAt
    lastTradeAt
    tradeCount
    isActive
    digitalTwin {
      id
    }
  }
}`

export async function subgraphRequest<T>(
  query: string,
  variables: Record<string, unknown>
): Promise<T | null> {
  const url = getSubgraphUrl()
  if (!url) {
    return null
  }

  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  }, {
    attempts: 3,
    timeoutMs: 10_000,
    initialBackoffMs: 500,
    maxBackoffMs: 4_000,
    dependency: "subgraph",
    operation: "subgraph_request",
  })

  if (!response.ok) {
    throw new Error(`Subgraph request failed with status ${response.status}`)
  }

  const payload = (await response.json()) as GraphResponse<T>
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join("; "))
  }

  return payload.data ?? null
}

export async function fetchHomepageSubgraphData() {
  return subgraphRequest<{
    protocolStats: { totalTwins: string } | null
    recentTrades: unknown[]
    trendingTwins: unknown[]
    newTwins: unknown[]
    recentlyActiveTwins: unknown[]
  }>(HOME_QUERY, {
    trendingFirst: 6,
    newFirst: 15,
    activeFirst: 15,
  })
}

export async function fetchTwinDetailSubgraphData(id: string) {
  return subgraphRequest<{
    digitalTwin: unknown | null
    hourlySnapshots: unknown[]
  }>(TWIN_DETAIL_QUERY, {
    id,
    tradesFirst: 20,
    holdersFirst: 20,
    hourlyFirst: 720,
  })
}

export async function fetchMomentumSnapshots(ids: string[]) {
  if (ids.length === 0) {
    return []
  }

  const payload = await subgraphRequest<{
    hourlySnapshots: unknown[]
  }>(MOMENTUM_SNAPSHOTS_QUERY, {
    ids,
    first: Math.max(ids.length * 30, 48),
  })

  return payload?.hourlySnapshots ?? []
}

export async function fetchPortfolioTwinHolders(account: string) {
  const payload = await subgraphRequest<{
    twinHolders: unknown[]
  }>(PORTFOLIO_TWIN_HOLDERS_QUERY, {
    holder: account,
    first: 50,
  })

  return payload?.twinHolders ?? []
}
