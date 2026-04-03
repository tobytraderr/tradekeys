import "server-only"

import { lookup } from "node:dns/promises"
import net from "node:net"

type RemoteUrlOptions = {
  label: string
  allowHttp?: boolean
  allowedHosts?: string[]
}

const globalState = globalThis as typeof globalThis & {
  __tradekeysRemoteHostResolutionCache?: Map<string, { checkedAt: number; addresses: string[] }>
}

const hostResolutionCache =
  globalState.__tradekeysRemoteHostResolutionCache ??
  (globalState.__tradekeysRemoteHostResolutionCache = new Map())

const HOST_CACHE_TTL_MS = 5 * 60_000

function isPrivateIpv4(value: string) {
  const parts = value.split(".").map((entry) => Number.parseInt(entry, 10))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false
  }

  const [a, b] = parts
  if (a === 10 || a === 127 || a === 0) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  return false
}

function isPrivateIpv6(value: string) {
  const normalized = value.toLowerCase()
  if (normalized === "::1" || normalized === "::") return true
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true
  if (normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) {
    return true
  }
  if (normalized.startsWith("::ffff:")) {
    return isPrivateIpv4(normalized.slice("::ffff:".length))
  }
  return false
}

function isPrivateIp(value: string) {
  const version = net.isIP(value)
  if (version === 4) return isPrivateIpv4(value)
  if (version === 6) return isPrivateIpv6(value)
  return false
}

async function resolveHostAddresses(hostname: string) {
  const cached = hostResolutionCache.get(hostname)
  if (cached && cached.checkedAt + HOST_CACHE_TTL_MS > Date.now()) {
    return cached.addresses
  }

  const records = await lookup(hostname, { all: true })
  const addresses = records.map((record) => record.address)
  hostResolutionCache.set(hostname, {
    checkedAt: Date.now(),
    addresses,
  })
  return addresses
}

function assertAllowedHostname(hostname: string, input: RemoteUrlOptions) {
  const normalized = hostname.toLowerCase()
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal")
  ) {
    throw new Error(`${input.label} hostname is not allowed.`)
  }

  if (input.allowedHosts && input.allowedHosts.length > 0 && !input.allowedHosts.includes(normalized)) {
    throw new Error(`${input.label} host is not in the allowed host list.`)
  }
}

export async function normalizeSafeRemoteUrl(rawValue: string, input: RemoteUrlOptions) {
  const trimmed = rawValue.trim()
  if (!trimmed) {
    throw new Error(`${input.label} is required.`)
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error(`${input.label} must be a valid absolute URL.`)
  }

  const protocol = parsed.protocol.toLowerCase()
  if (protocol !== "https:" && !(input.allowHttp && protocol === "http:")) {
    throw new Error(`${input.label} must use ${input.allowHttp ? "http or https" : "https"}.`)
  }

  if (parsed.username || parsed.password) {
    throw new Error(`${input.label} cannot include credentials.`)
  }

  if (parsed.port && !["80", "443"].includes(parsed.port)) {
    throw new Error(`${input.label} must use a standard web port.`)
  }

  assertAllowedHostname(parsed.hostname, input)

  if (net.isIP(parsed.hostname) && isPrivateIp(parsed.hostname)) {
    throw new Error(`${input.label} cannot target a private or loopback address.`)
  }

  const resolvedAddresses: string[] = await resolveHostAddresses(parsed.hostname)
  if (resolvedAddresses.length === 0) {
    throw new Error(`${input.label} host could not be resolved safely.`)
  }

  if (resolvedAddresses.some((address: string) => isPrivateIp(address))) {
    throw new Error(`${input.label} cannot target a private or loopback network.`)
  }

  return parsed
}
