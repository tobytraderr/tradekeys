import "server-only"

import {
  getBscRpcUrl,
  getDatabaseUrl,
  getMarketDataRuntimeSource,
  getOpenGradientPrivateKey,
  getPythonBin,
  getSubgraphUrl,
} from "@/lib/env"
import type { AdminEnvValidation, AdminPlaybook } from "@/lib/admin-types"

export function getEnvValidation(): AdminEnvValidation {
  const environment = process.env.NODE_ENV?.trim() || "development"
  const missingCritical: string[] = []
  const warnings: string[] = []
  const defaultsInUse: string[] = []

  if (!getDatabaseUrl()) {
    missingCritical.push("DATABASE_URL")
  }

  if (!getBscRpcUrl()) {
    missingCritical.push("BSC_RPC_URL")
  }

  if (!getSubgraphUrl() && getMarketDataRuntimeSource() === "legacy") {
    missingCritical.push("SUBGRAPH_URL")
  }

  if (!getSubgraphUrl() && getMarketDataRuntimeSource() === "ingestion") {
    warnings.push("SUBGRAPH_URL is missing; ingestion reads can only rely on stored snapshots and fallback behavior.")
  }

  if (!getOpenGradientPrivateKey()) {
    warnings.push("OPENGRADIENT_PRIVATE_KEY is missing; copilot will stay degraded or unavailable.")
  }

  if ((process.env.PYTHON_BIN?.trim() ?? "") === "") {
    defaultsInUse.push(`PYTHON_BIN=${getPythonBin()}`)
  }

  if ((process.env.OPENGRADIENT_MODEL?.trim() ?? "") === "") {
    defaultsInUse.push("OPENGRADIENT_MODEL=GPT_5_2")
  }

  if ((process.env.TWINFUN_INDEXER_URL?.trim() ?? "") === "") {
    defaultsInUse.push("TWINFUN_INDEXER_URL=https://twinindexer.memchat.io/subgraphs/name/digital")
  }

  if ((process.env.MARKET_DATA_RUNTIME_SOURCE?.trim() ?? "") === "") {
    defaultsInUse.push(`MARKET_DATA_RUNTIME_SOURCE=${getMarketDataRuntimeSource()}`)
  }

  if ((process.env.MARKET_DATA_LEGACY_FALLBACK_ENABLED?.trim() ?? "") === "") {
    defaultsInUse.push("MARKET_DATA_LEGACY_FALLBACK_ENABLED=true")
  }

  return {
    environment,
    healthy: missingCritical.length === 0,
    missingCritical,
    warnings,
    defaultsInUse,
  }
}

export function getIncidentPlaybooks(): AdminPlaybook[] {
  return [
    {
      id: "subgraph_outage",
      title: "Subgraph outage",
      summary: "Keep browse surfaces alive from stored snapshots and cut live subgraph dependence until upstream recovers.",
      steps: [
        "Confirm `/api/admin/health` marks `subgraph` degraded or down and check recent 429 or fetch failures in the ops log tail.",
        "Keep `MARKET_DATA_LEGACY_FALLBACK_ENABLED=true` so stale homepage/detail snapshots continue serving.",
        "Pause any manual cache invalidation until the upstream is healthy again.",
        "Once the subgraph recovers, refresh homepage and twin-detail runtime snapshots and confirm cache age falls back inside TTL.",
      ],
    },
    {
      id: "rpc_outage",
      title: "RPC outage",
      summary: "Live quotes and wallet balance reads are execution-critical; surface degradation fast and stop trusting quote paths until RPC health returns.",
      steps: [
        "Check `/api/admin/health` for `bsc-rpc` and review quote-path failures plus transaction submission failures in ops events.",
        "Warn users that browse data can remain available while execution is degraded.",
        "Fail closed on live quote routes until RPC health returns rather than serving invented execution values.",
        "After recovery, verify quote latency and success rate normalize before clearing the incident.",
      ],
    },
    {
      id: "db_outage",
      title: "DB outage",
      summary: "Watchlists, alerts, admin tables, and snapshot persistence depend on Postgres; degrade cleanly and avoid write loops.",
      steps: [
        "Check `/api/admin/health` for `database` and inspect DB error alerts in the admin console.",
        "Keep read-only market pages available where possible but expect watchlists, alerts, admin tables, and snapshot persistence to degrade.",
        "Do not run migrations or retry-heavy manual jobs while the database is unhealthy.",
        "After recovery, verify write routes and cache persistence paths before declaring the incident closed.",
      ],
    },
    {
      id: "wallet_provider_breakage",
      title: "Wallet provider breakage",
      summary: "Client wallet issues should be visible through wallet-connect and transaction-submission telemetry even when the server is healthy.",
      steps: [
        "Check recent client telemetry for wallet connect failures and transaction submission failures.",
        "Verify an EIP-1193 wallet is present and chain switching still targets BNB Smart Chain.",
        "Keep browse surfaces available while execution buttons show the degraded state.",
        "After a fix, verify wallet connect failures drop and at least one live buy flow succeeds.",
      ],
    },
  ]
}
