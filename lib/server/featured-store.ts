import "server-only"

import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import type { FeaturedOverride } from "@/lib/types"

const DATA_DIR = path.join(process.cwd(), "data")
const FEATURED_FILE = path.join(DATA_DIR, "featured-override.json")

function isValidTwinId(value: string): boolean {
  return /^0x[a-fA-F0-9]{32}$/.test(value.trim())
}

export async function getFeaturedOverride(): Promise<FeaturedOverride | null> {
  try {
    const raw = await readFile(FEATURED_FILE, "utf8")
    const parsed = JSON.parse(raw) as FeaturedOverride
    if (!parsed?.twinId || !isValidTwinId(parsed.twinId) || !parsed?.label) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export async function setFeaturedOverride(input: {
  twinId: string
  label?: string
}): Promise<FeaturedOverride> {
  const twinId = input.twinId.trim()
  if (!isValidTwinId(twinId)) {
    throw new Error("Twin override must be a bytes16 hex ID like 0x85f4f72079114bfcac1003134e5424f4.")
  }

  const record: FeaturedOverride = {
    twinId,
    label: (input.label?.trim() || "Admin Pick").slice(0, 80),
    updatedAt: new Date().toISOString(),
  }

  await mkdir(DATA_DIR, { recursive: true })
  const tempFile = `${FEATURED_FILE}.tmp`
  await writeFile(tempFile, JSON.stringify(record, null, 2), "utf8")
  await rename(tempFile, FEATURED_FILE)
  return record
}

export async function clearFeaturedOverride(): Promise<void> {
  try {
    await unlink(FEATURED_FILE)
  } catch {
    // no-op when file does not exist
  }
}
