import type { HomepageSnapshot, TwinDetailSnapshot } from "@/lib/types"

export const HOMEPAGE_RUNTIME_SNAPSHOT_KEY = "homepage:default"
export const HOMEPAGE_RUNTIME_TTL_MS = 60_000
export const TWIN_DETAIL_RUNTIME_TTL_MS = 60_000

let homepageRefreshPromise: Promise<unknown> | null = null
const twinDetailRefreshPromises = new Map<string, Promise<TwinDetailSnapshot | null>>()

export function isRuntimeSnapshotFresh(generatedAt: string | null | undefined, ttlMs: number) {
  return Boolean(generatedAt && Date.now() - Date.parse(generatedAt) < ttlMs)
}

export async function withHomepageRefreshLock<T>(task: () => Promise<T>): Promise<T> {
  if (homepageRefreshPromise) {
    return homepageRefreshPromise as Promise<T>
  }

  homepageRefreshPromise = task().finally(() => {
    homepageRefreshPromise = null
  })

  return homepageRefreshPromise as Promise<T>
}

export async function withTwinDetailRefreshLock(
  twinId: string,
  task: () => Promise<TwinDetailSnapshot | null>
) {
  const existing = twinDetailRefreshPromises.get(twinId)
  if (existing) {
    return existing
  }

  const refreshPromise = task().finally(() => {
    twinDetailRefreshPromises.delete(twinId)
  })
  twinDetailRefreshPromises.set(twinId, refreshPromise)
  return refreshPromise
}
