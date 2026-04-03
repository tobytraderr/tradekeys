import { sanitizeCopilotText } from "@/lib/copilot-security"

const PENDING_COPILOT_PROMPT_KEY = "tradekeys.ai-copilot.pending-prompt"
const PENDING_COPILOT_PROMPT_TTL_MS = 5 * 60 * 1000

type PendingCopilotPrompt = {
  prompt: string
  createdAt: number
}

function canUseSessionStorage() {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined"
}

export function queuePendingCopilotPrompt(prompt: string) {
  if (!canUseSessionStorage()) {
    return
  }

  const sanitizedPrompt = sanitizeCopilotText(prompt, 600).trim()
  if (!sanitizedPrompt) {
    return
  }

  const payload: PendingCopilotPrompt = {
    prompt: sanitizedPrompt,
    createdAt: Date.now(),
  }

  try {
    window.sessionStorage.setItem(PENDING_COPILOT_PROMPT_KEY, JSON.stringify(payload))
  } catch {
    // ignore storage access failure
  }
}

export function consumePendingCopilotPrompt() {
  if (!canUseSessionStorage()) {
    return null
  }

  try {
    const raw = window.sessionStorage.getItem(PENDING_COPILOT_PROMPT_KEY)
    window.sessionStorage.removeItem(PENDING_COPILOT_PROMPT_KEY)

    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as PendingCopilotPrompt
    if (
      !parsed ||
      typeof parsed.prompt !== "string" ||
      typeof parsed.createdAt !== "number" ||
      !Number.isFinite(parsed.createdAt)
    ) {
      return null
    }

    if (Date.now() - parsed.createdAt > PENDING_COPILOT_PROMPT_TTL_MS) {
      return null
    }

    const sanitizedPrompt = sanitizeCopilotText(parsed.prompt, 600).trim()
    return sanitizedPrompt || null
  } catch {
    return null
  }
}
