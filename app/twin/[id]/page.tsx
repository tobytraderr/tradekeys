import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { TwinDetailTerminal } from "@/components/twin-detail-terminal"
import { getTwinDetailSnapshot } from "@/lib/services/market/detail"
import { buildImageProxyUrl } from "@/lib/image-proxy"
import { getSiteOrigin } from "@/lib/site-url"

function formatCompactUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value)
}

function buildShareDescription(snapshot: NonNullable<Awaited<ReturnType<typeof getTwinDetailSnapshot>>>) {
  const twin = snapshot.twin
  const primaryDescription =
    twin.description?.trim() ||
    `Discover ${twin.displayName} on TradeKeys and trade twin keys with live quote checks.`
  const stats = [
    `${twin.holders.toLocaleString()} holders`,
    `$${formatCompactUsd(twin.volume24hUsd)} 24H volume`,
    `${twin.change1hPct >= 0 ? "+" : ""}${twin.change1hPct.toFixed(1)}% 1H`,
  ]

  return `${primaryDescription} ${stats.join(" • ")}. Discover digital twins faster on TradeKeys.`
}

function buildShareImage(snapshot: NonNullable<Awaited<ReturnType<typeof getTwinDetailSnapshot>>>) {
  const proxyPath = buildImageProxyUrl(snapshot.twin.avatarUrl)
  if (!proxyPath) {
    return "/onboarding/first slide.png"
  }

  return `${getSiteOrigin()}${proxyPath}`
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const snapshot = await getTwinDetailSnapshot(id)
  const canonicalPath = `/twin/${id}`

  if (!snapshot) {
    return {
      title: "Twin not found | TradeKeys",
      description: "TradeKeys twin page unavailable.",
      alternates: {
        canonical: canonicalPath,
      },
    }
  }

  const title = `${snapshot.twin.displayName} | TradeKeys`
  const description = buildShareDescription(snapshot)
  const image = buildShareImage(snapshot)

  return {
    title,
    description,
    alternates: {
      canonical: canonicalPath,
    },
    openGraph: {
      title,
      description,
      type: "website",
      siteName: "TradeKeys",
      url: canonicalPath,
      images: [
        {
          url: image,
          alt: `${snapshot.twin.displayName} on TradeKeys`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  }
}

export default async function TwinDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const snapshot = await getTwinDetailSnapshot(id)

  if (!snapshot) {
    notFound()
  }

  return <TwinDetailTerminal snapshot={snapshot} />
}
