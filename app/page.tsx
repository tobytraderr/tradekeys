import { HomeTerminal } from "@/components/home-terminal"
import { getHomepageSnapshot } from "@/lib/services/market/homepage"

export const dynamic = "force-dynamic"

export default async function HomePage() {
  const snapshot = await getHomepageSnapshot()

  return <HomeTerminal initialSnapshot={snapshot} />
}
