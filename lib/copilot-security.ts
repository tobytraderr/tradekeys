const MAX_COPILOT_TEXT_CHARS = 12_000

function stripUnsafeControlChars(value: string) {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
}

export function sanitizeCopilotText(value: string, maxChars = MAX_COPILOT_TEXT_CHARS) {
  return stripUnsafeControlChars(value).slice(0, maxChars)
}

export function sanitizeCopilotLinkUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 2_048) {
    return null
  }

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      return parsed.toString()
    }
  } catch {
    return null
  }

  return null
}
