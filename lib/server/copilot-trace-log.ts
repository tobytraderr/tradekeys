import "server-only"

import { appendFile, mkdir } from "node:fs/promises"
import path from "node:path"

const TRACE_DIR = path.join(process.cwd(), "data", "copilot")
export const COPILOT_TRACE_FILE = path.join(TRACE_DIR, "copilot-trace.ndjson")

function serializeTracePayload(payload: unknown) {
  return JSON.parse(
    JSON.stringify(payload, (_key, value) => {
      if (typeof value === "bigint") {
        return value.toString()
      }

      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack,
        }
      }

      return value
    })
  )
}

export function createCopilotTraceId() {
  return `copilot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export async function logCopilotTrace(input: {
  traceId: string
  stage: string
  payload?: unknown
}) {
  const entry = {
    timestamp: new Date().toISOString(),
    traceId: input.traceId,
    stage: input.stage,
    ...(input.payload !== undefined ? { payload: serializeTracePayload(input.payload) } : {}),
  }

  try {
    await mkdir(TRACE_DIR, { recursive: true })
    await appendFile(COPILOT_TRACE_FILE, `${JSON.stringify(entry)}\n`, "utf8")
  } catch (error) {
    console.error("[copilot-trace] failed to append trace log:", error)
  }
}
