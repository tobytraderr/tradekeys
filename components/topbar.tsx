import { TopbarClient } from "@/components/topbar-client"
import { getAppMeta } from "@/lib/services/twins"

export async function Topbar() {
  const meta = await getAppMeta()

  return <TopbarClient totalTwins={meta.totalTwins} />
}
