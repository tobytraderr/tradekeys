import "server-only"

import { spawn } from "node:child_process"
import { sanitizeCopilotText } from "@/lib/copilot-security"
import { getOpenGradientModel, getOpenGradientPrivateKey, getPythonBin } from "@/lib/env"
import type { CopilotResult, TwinSummary } from "@/lib/types"

type CopilotRequest = {
  prompt: string
  twins?: TwinSummary[]
  systemInstruction?: string
  metadata?: Record<string, unknown>
}

export async function summarizeWithOpenGradient(request: CopilotRequest): Promise<CopilotResult> {
  const pythonBin = getPythonBin()
  const privateKey = getOpenGradientPrivateKey()
  const model = getOpenGradientModel()
  if (!privateKey) {
    return {
      provider: "opengradient",
      content: "OpenGradient is not configured yet. Set OPENGRADIENT_PRIVATE_KEY to enable verifiable AI responses.",
    }
  }

  return new Promise<CopilotResult>((resolve, reject) => {
    const child = spawn(
      pythonBin,
      ["scripts/opengradient_copilot.py"],
      {
        cwd: process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          OPENGRADIENT_PRIVATE_KEY: privateKey,
          OPENGRADIENT_MODEL: model,
        },
      }
    )

    let stdout = ""
    let stderr = ""

    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error("OpenGradient bridge timed out"))
    }, 60000)

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })

    child.on("error", (error) => {
      clearTimeout(timeout)
      reject(error)
    })

    child.on("close", (code) => {
      clearTimeout(timeout)
      if (code !== 0) {
        reject(new Error(stderr.trim() || `OpenGradient bridge exited with code ${code}`))
        return
      }
      try {
        const parsed = JSON.parse(stdout) as CopilotResult
        resolve({
          ...parsed,
          content: sanitizeCopilotText(typeof parsed.content === "string" ? parsed.content : "", 12_000),
          ...(typeof parsed.provider === "string"
            ? { provider: sanitizeCopilotText(parsed.provider, 80) }
            : {}),
          ...(typeof parsed.modelName === "string"
            ? { modelName: sanitizeCopilotText(parsed.modelName, 120) }
            : {}),
        })
      } catch (error) {
        reject(error)
      }
    })

    child.stdin.write(JSON.stringify(request))
    child.stdin.end()
  })
}
