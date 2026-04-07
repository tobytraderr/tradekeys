import { HomeTerminal } from "@/components/home-terminal"
import { getHomepageSnapshotForPublicRequest } from "@/lib/services/market/homepage"

export const dynamic = "force-dynamic"

export default async function HomePage() {
  const snapshot = await getHomepageSnapshotForPublicRequest()

  return <HomeTerminal initialSnapshot={snapshot} />
}
