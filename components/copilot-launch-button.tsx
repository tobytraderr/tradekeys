"use client"

import type { ReactNode } from "react"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { useWallet } from "@/components/wallet-provider"
import { showActionFeedbackNotice, startActionFeedback } from "@/lib/action-feedback"
import { queuePendingCopilotPrompt } from "@/lib/copilot-launch"
import { fetchCopilotQuota } from "@/lib/copilot-quota-client"

type Props = {
  prompt: string
  className?: string
  children: ReactNode
}

export function CopilotLaunchButton({ prompt, className, children }: Props) {
  const router = useRouter()
  const { account } = useWallet()
  const [checkingQuota, setCheckingQuota] = useState(false)

  async function handleClick() {
    setCheckingQuota(true)
    let nextQuota = null
    try {
      nextQuota = await fetchCopilotQuota(account)
    } catch (cause) {
      showActionFeedbackNotice({
        label: cause instanceof Error ? cause.message : "Could not check AI Copilot availability.",
        tone: "error",
      })
      return
    } finally {
      setCheckingQuota(false)
    }

    if (!nextQuota) {
      showActionFeedbackNotice({
        label: "Could not check AI Copilot availability.",
        tone: "error",
      })
      return
    }

    if (nextQuota.enabled && nextQuota.exhausted) {
      showActionFeedbackNotice({
        label: "Daily AI Copilot limit reached for this user.",
        tone: "error",
      })
      return
    }

    startActionFeedback({ label: "Opening copilot", persistent: true })
    queuePendingCopilotPrompt(prompt)
    router.push("/ai-copilot")
  }

  return (
    <button
      type="button"
      className={className}
      onClick={() => void handleClick()}
      disabled={checkingQuota}
      aria-disabled={checkingQuota}
    >
      {children}
    </button>
  )
}
