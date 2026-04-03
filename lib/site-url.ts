import { getSiteUrl } from "@/lib/env"

function normalizeOrigin(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed.replace(/\/+$/, "")
  }

  return `https://${trimmed.replace(/\/+$/, "")}`
}

export function getSiteOrigin() {
  return normalizeOrigin(getSiteUrl() ?? "") ?? "http://localhost:3000"
}

export function getSiteUrlObject() {
  return new URL(getSiteOrigin())
}
