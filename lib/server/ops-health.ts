import "server-only"

import { spawn } from "node:child_process"
import { createPublicClient, http } from "viem"
import { bsc } from "viem/chains"
import type { AdminHealthCheck } from "@/lib/admin-types"
import {
  getBscRpcUrl,
  getOpenGradientPrivateKey,
  getPythonBin,
  getSubgraphUrl,
} from "@/lib/env"
import { fetchWithRetry } from "@/lib/server/fetch-utils"
import { getDb, isDatabaseConfigured } from "@/lib/server/db"
import { recordDbError, recordOpsEvent } from "@/lib/server/ops-observability"

function buildCheck(
  target: AdminHealthCheck["target"],
  status: AdminHealthCheck["status"],
  detail: string,
  latencyMs: number | null
): AdminHealthCheck {
  return {
    target,
    status,
    detail,
    latencyMs,
    checkedAt: new Date().toISOString(),
  }
}

async function checkDatabaseHealth(): Promise<AdminHealthCheck> {
  if (!isDatabaseConfigured()) {
    return buildCheck("database", "down", "DATABASE_URL is not configured.", null)
  }

  const startedAt = Date.now()
  try {
    await getDb().query("select 1")
    return buildCheck("database", "ok", "Postgres responded successfully.", Date.now() - startedAt)
  } catch (error) {
    recordDbError("healthcheck", error)
    return buildCheck(
      "database",
      "down",
      error instanceof Error ? error.message : "Database health check failed.",
      Date.now() - startedAt
    )
  }
}

async function checkSubgraphHealth(): Promise<AdminHealthCheck> {
  const url = getSubgraphUrl()
  if (!url) {
    return buildCheck("subgraph", "down", "SUBGRAPH_URL is not configured.", null)
  }

  const startedAt = Date.now()
  try {
    const response = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "query Healthcheck { protocolStats(id: \"protocol\") { totalTwins } }",
          variables: {},
        }),
        cache: "no-store",
      },
      {
        attempts: 2,
        timeoutMs: 6_000,
        initialBackoffMs: 250,
        maxBackoffMs: 1_000,
        dependency: "subgraph",
        operation: "subgraph_healthcheck",
      }
    )

    if (!response.ok) {
      return buildCheck(
        "subgraph",
        response.status === 429 ? "degraded" : "down",
        `Subgraph returned HTTP ${response.status}.`,
        Date.now() - startedAt
      )
    }

    return buildCheck("subgraph", "ok", "Subgraph responded successfully.", Date.now() - startedAt)
  } catch (error) {
    return buildCheck(
      "subgraph",
      "down",
      error instanceof Error ? error.message : "Subgraph health check failed.",
      Date.now() - startedAt
    )
  }
}

async function checkRpcHealth(): Promise<AdminHealthCheck> {
  const rpcUrl = getBscRpcUrl()
  if (!rpcUrl) {
    return buildCheck("bsc-rpc", "down", "BSC_RPC_URL is not configured.", null)
  }

  const startedAt = Date.now()
  try {
    const client = createPublicClient({
      chain: bsc,
      transport: http(rpcUrl, {
        timeout: 6_000,
        retryCount: 1,
        retryDelay: 250,
      }),
    })
    await client.getBlockNumber()
    return buildCheck("bsc-rpc", "ok", "RPC responded successfully.", Date.now() - startedAt)
  } catch (error) {
    return buildCheck(
      "bsc-rpc",
      "down",
      error instanceof Error ? error.message : "RPC health check failed.",
      Date.now() - startedAt
    )
  }
}

type PythonProbeResult = {
  ok: boolean
  stdout: string
  stderr: string
}

function runPythonProbe(pythonBin: string, args: string[]): Promise<PythonProbeResult> {
  return new Promise((resolve) => {
    const child = spawn(pythonBin, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    })

    let stdout = ""
    let stderr = ""

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })

    child.on("error", (error) =>
      resolve({
        ok: false,
        stdout,
        stderr: error instanceof Error ? error.message : String(error),
      })
    )
    child.on("close", (code) =>
      resolve({
        ok: code === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      })
    )
  })
}

async function checkAiHealth(): Promise<AdminHealthCheck> {
  const startedAt = Date.now()
  if (!getOpenGradientPrivateKey()) {
    return buildCheck(
      "ai-provider",
      "degraded",
      "OPENGRADIENT_PRIVATE_KEY is missing; copilot stays unavailable or degraded.",
      null
    )
  }

  const pythonBin = getPythonBin()
  const pythonReady = await runPythonProbe(pythonBin, ["--version"])
  if (!pythonReady.ok) {
    return buildCheck(
      "ai-provider",
      "down",
      `Python binary "${pythonBin}" could not be executed.${pythonReady.stderr ? ` ${pythonReady.stderr}` : ""}`,
      Date.now() - startedAt
    )
  }

  const sdkReady = await runPythonProbe(pythonBin, ["-c", "import opengradient"])
  if (!sdkReady.ok) {
    return buildCheck(
      "ai-provider",
      "down",
      `Python bridge is missing the OpenGradient SDK for "${pythonBin}".${sdkReady.stderr ? ` ${sdkReady.stderr}` : sdkReady.stdout ? ` ${sdkReady.stdout}` : ""}`,
      Date.now() - startedAt
    )
  }

  return buildCheck(
    "ai-provider",
    "ok",
    "Python bridge and OpenGradient signer configuration look ready.",
    Date.now() - startedAt
  )
}

export async function getAdminHealthChecks(): Promise<AdminHealthCheck[]> {
  const checks = await Promise.all([
    checkDatabaseHealth(),
    checkSubgraphHealth(),
    checkRpcHealth(),
    checkAiHealth(),
  ])

  for (const check of checks) {
    recordOpsEvent({
      level: check.status === "ok" ? "info" : check.status === "degraded" ? "warn" : "error",
      category: "health",
      name: `health.${check.target}`,
      message: check.detail,
      dependency:
        check.target === "bsc-rpc"
          ? "rpc"
          : check.target === "ai-provider"
            ? "ai"
            : check.target,
      durationMs: check.latencyMs ?? undefined,
      data: { status: check.status },
    })
  }

  return checks
}
