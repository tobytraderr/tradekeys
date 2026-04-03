import { AiCopilotConsole } from "@/components/ai-copilot-console"
import { getAiCopilotSnapshot } from "@/lib/services/market/insights"

export const dynamic = "force-dynamic"

export default async function AiCopilotPage() {
  const snapshot = await getAiCopilotSnapshot()
  return <AiCopilotConsole snapshot={snapshot} />
}
