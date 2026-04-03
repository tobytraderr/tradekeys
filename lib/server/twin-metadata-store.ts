import "server-only"

import { createHash } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { getMaxMetadataFetchBytes, getMetadataFetchAllowedHosts } from "@/lib/env"
import { normalizeSafeRemoteUrl } from "@/lib/server/remote-resource"
import type { TwinMetadata } from "@/lib/types"

const DATA_DIR = path.join(process.cwd(), "data")
const CACHE_FILE = path.join(DATA_DIR, "twin-metadata-cache.json")
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 12

type CacheShape = {
  items: Record<string, TwinMetadata>
}

function hashPayload(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex")
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function toStringMap(value: unknown): Record<string, string> | undefined {
  if (!isObject(value)) return undefined
  const entries = Object.entries(value).flatMap(([key, entry]) =>
    typeof entry === "string" ? ([[key, entry]] as const) : []
  )
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function normalizePayload(twinId: string, url: string, payload: unknown): TwinMetadata {
  const object = isObject(payload) ? payload : {}
  const name = typeof object.name === "string" ? object.name : undefined
  const description = typeof object.description === "string" ? object.description : undefined
  const imageUrl =
    typeof object.image_url === "string"
      ? object.image_url
      : typeof object.image === "string"
        ? object.image
        : undefined

  const starterQuestions = Array.isArray(object.starter_questions)
    ? object.starter_questions.filter((item): item is string => typeof item === "string")
    : undefined

  return {
    twinId,
    url,
    fetchedAt: new Date().toISOString(),
    payloadHash: hashPayload(payload),
    name,
    description,
    imageUrl,
    links: toStringMap(object.links),
    starterQuestions,
    rawPayload: payload,
  }
}

async function readCache(): Promise<CacheShape> {
  try {
    const raw = await readFile(CACHE_FILE, "utf8")
    const parsed = JSON.parse(raw) as CacheShape
    if (!parsed || typeof parsed !== "object" || !parsed.items || typeof parsed.items !== "object") {
      return { items: {} }
    }
    return parsed
  } catch {
    return { items: {} }
  }
}

async function writeCache(cache: CacheShape) {
  await mkdir(DATA_DIR, { recursive: true })
  const tempFile = `${CACHE_FILE}.tmp`
  await writeFile(tempFile, JSON.stringify(cache, null, 2), "utf8")
  await rename(tempFile, CACHE_FILE)
}

function isFresh(record: TwinMetadata, ttlMs: number) {
  const fetchedAt = Date.parse(record.fetchedAt)
  if (!Number.isFinite(fetchedAt)) return false
  return Date.now() - fetchedAt < ttlMs
}

async function fetchMetadataUrl(url: string) {
  const remoteUrl = await normalizeSafeRemoteUrl(url, {
    label: "Metadata URL",
    allowHttp: true,
    allowedHosts: getMetadataFetchAllowedHosts(),
  })

  const response = await fetch(remoteUrl, {
    method: "GET",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    throw new Error(`Metadata request failed with status ${response.status}`)
  }

  const advertisedLength = Number(response.headers.get("content-length"))
  const maxBytes = getMaxMetadataFetchBytes()
  if (Number.isFinite(advertisedLength) && advertisedLength > maxBytes) {
    throw new Error("Metadata payload exceeds max size.")
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
  if (contentType && !contentType.includes("json")) {
    throw new Error("Metadata response must be JSON.")
  }

  const raw = await response.text()
  if (Buffer.byteLength(raw, "utf8") > maxBytes) {
    throw new Error("Metadata payload exceeds max size.")
  }

  return JSON.parse(raw) as unknown
}

export async function getTwinMetadata(
  twinId: string,
  url?: string,
  ttlMs = DEFAULT_TTL_MS
): Promise<TwinMetadata | null> {
  if (!url) return null

  const cache = await readCache()
  const cached = cache.items[twinId]
  if (cached && cached.url === url && isFresh(cached, ttlMs)) {
    return cached
  }

  try {
    const payload = await fetchMetadataUrl(url)
    const normalized = normalizePayload(twinId, url, payload)
    cache.items[twinId] = normalized
    await writeCache(cache)
    return normalized
  } catch {
    return cached && cached.url === url ? cached : null
  }
}

export async function getTwinMetadataBatch(
  twins: Array<{ id: string; metadataUrl?: string }>,
  ttlMs = DEFAULT_TTL_MS
) {
  const entries = await Promise.all(
    twins.map(async (twin) => [twin.id, await getTwinMetadata(twin.id, twin.metadataUrl, ttlMs)] as const)
  )
  return Object.fromEntries(entries)
}
