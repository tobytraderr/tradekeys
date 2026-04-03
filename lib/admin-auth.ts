import { getAdminAccessToken, getAdminAllowedIps, getAdminPassword, getAdminUsername } from "@/lib/env"

export type AdminCredentials = {
  username: string
  password: string
}

export function getAdminCredentials(): AdminCredentials | null {
  const username = getAdminUsername()
  const password = getAdminPassword()
  if (!username || !password) {
    return null
  }

  return { username, password }
}

export function isAdminConfigured() {
  return Boolean(getAdminCredentials())
}

export function getAdminUsernameHint() {
  const username = getAdminUsername()
  if (!username) {
    return null
  }

  if (username.length <= 2) {
    return `${username[0] ?? "*"}*`
  }

  return `${username.slice(0, 2)}${"*".repeat(Math.max(2, username.length - 2))}`
}

export function decodeBasicAuthorizationHeader(headerValue: string | null) {
  if (!headerValue) {
    return null
  }

  const [scheme, encoded] = headerValue.split(" ")
  if (scheme !== "Basic" || !encoded) {
    return null
  }

  try {
    const decoded = atob(encoded)
    const separatorIndex = decoded.indexOf(":")
    if (separatorIndex === -1) {
      return null
    }

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    }
  } catch {
    return null
  }
}

function normalizeIp(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return ""
  }

  return trimmed.startsWith("::ffff:") ? trimmed.slice(7) : trimmed
}

function timingSafeEqualString(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left)
  const rightBytes = new TextEncoder().encode(right)
  const maxLength = Math.max(leftBytes.length, rightBytes.length)
  let mismatch = leftBytes.length ^ rightBytes.length

  for (let index = 0; index < maxLength; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0)
  }

  return mismatch === 0
}

export function hasValidAdminAuthorization(headerValue: string | null) {
  const credentials = getAdminCredentials()
  if (!credentials) {
    return false
  }

  const decoded = decodeBasicAuthorizationHeader(headerValue)
  if (!decoded) {
    return false
  }

  return (
    timingSafeEqualString(decoded.username, credentials.username) &&
    timingSafeEqualString(decoded.password, credentials.password)
  )
}

export function getAdminAccessTokenValue() {
  return getAdminAccessToken()
}

export function isValidAdminAccessToken(value: string | null | undefined) {
  const expected = getAdminAccessToken()
  if (!expected) {
    return true
  }

  if (!value) {
    return false
  }

  return timingSafeEqualString(value, expected)
}

export function getAdminAllowedIpList() {
  return getAdminAllowedIps().map(normalizeIp)
}

export function isAllowedAdminIp(ip: string | null | undefined) {
  const allowedIps = getAdminAllowedIpList()
  if (allowedIps.length === 0) {
    return true
  }

  if (!ip) {
    return false
  }

  return allowedIps.includes(normalizeIp(ip))
}
