import type { Metadata } from "next"
import { FirstTimeOnboarding } from "@/components/first-time-onboarding"
import { GlobalActionFeedback } from "@/components/global-action-feedback"
import { QuickBuySettingsProvider } from "@/components/quick-buy-settings-provider"
import { Sidebar } from "@/components/sidebar"
import { Topbar } from "@/components/topbar"
import { WatchlistProvider } from "@/components/watchlist-provider"
import { WalletProvider } from "@/components/wallet-provider"
import { getSiteUrlObject } from "@/lib/site-url"
import "./globals.css"

export const metadata: Metadata = {
  title: "TradeKeys",
  description: "Twin.fun-native digital twin keys trading terminal",
  metadataBase: getSiteUrlObject(),
  openGraph: {
    title: "TradeKeys",
    description: "Twin.fun-native digital twin keys trading terminal",
    siteName: "TradeKeys",
    type: "website",
    images: ["/onboarding/first slide.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "TradeKeys",
    description: "Twin.fun-native digital twin keys trading terminal",
    images: ["/onboarding/first slide.png"],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          <QuickBuySettingsProvider>
            <WatchlistProvider>
              <div className="app-shell">
                <Sidebar />
                <div className="page-wrap">
                  <Topbar />
                  <main className="page-content">{children}</main>
                  <FirstTimeOnboarding />
                  <GlobalActionFeedback />
                </div>
              </div>
            </WatchlistProvider>
          </QuickBuySettingsProvider>
        </WalletProvider>
      </body>
    </html>
  )
}
