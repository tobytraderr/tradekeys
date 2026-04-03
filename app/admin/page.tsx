import { notFound } from "next/navigation"
import { AdminPageClient } from "@/components/admin-page-client"
import { isAdminConfigured } from "@/lib/admin-auth"
import { getAdminOverview } from "@/lib/server/admin-overview"

export const dynamic = "force-dynamic"

export default async function AdminPage() {
  if (!isAdminConfigured()) {
    notFound()
  }

  const overview = await getAdminOverview()

  return <AdminPageClient initialOverview={overview} />
}
