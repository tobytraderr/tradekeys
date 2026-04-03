"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { TradeKeysLogo } from "@/components/tradekeys-logo"
import { UiIcon } from "@/components/ui-icon"
import styles from "./sidebar.module.css"

const links = [
  { href: "/", label: "Home", icon: "home" as const },
  { href: "/watchlist", label: "Watchlist", icon: "list" as const },
  { href: "/portfolio", label: "Portfolio", icon: "pie" as const },
  { href: "/ai-copilot", label: "AI Copilot", icon: "brain" as const },
  { href: "/settings/featured", label: "Settings", icon: "settings" as const },
]

const SIDEBAR_STORAGE_KEY = "tradekeys.sidebar.collapsed"

export function Sidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [viewportMode, setViewportMode] = useState<"desktop" | "tablet" | "mobile">("desktop")

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY)
      const nextCollapsed = stored === "1"
      setCollapsed(nextCollapsed)
    } catch {
      // ignore storage access failure
    }
  }, [])

  useEffect(() => {
    const syncViewportMode = () => {
      const width = window.innerWidth
      if (width <= 767) {
        setViewportMode("mobile")
        return
      }

      if (width <= 1180) {
        setViewportMode("tablet")
        return
      }

      setViewportMode("desktop")
    }

    syncViewportMode()
    window.addEventListener("resize", syncViewportMode)
    return () => window.removeEventListener("resize", syncViewportMode)
  }, [])

  const effectiveCollapsed = viewportMode === "tablet" ? true : collapsed

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty(
      "--sidebar-width",
      viewportMode === "mobile" ? "0px" : effectiveCollapsed ? "84px" : "280px"
    )

    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? "1" : "0")
    } catch {
      // ignore storage access failure
    }
  }, [collapsed, effectiveCollapsed, viewportMode])

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname, viewportMode])

  return (
    <>
      <button
        type="button"
        className={styles.mobileToggle}
        onClick={() => setMobileOpen((current) => !current)}
        aria-label={mobileOpen ? "Close menu" : "Open menu"}
      >
        <UiIcon name={mobileOpen ? "close" : "menu"} className={styles.mobileToggleIcon} />
      </button>
      {mobileOpen ? (
        <button
          type="button"
          aria-label="Close sidebar"
          className={styles.mobileBackdrop}
          onClick={() => setMobileOpen(false)}
        />
      ) : null}
      <aside
        className={`${styles.sidebar} ${effectiveCollapsed ? styles.sidebarCollapsed : ""} ${
          mobileOpen ? styles.sidebarMobileOpen : ""
        }`}
      >
        <div className={styles.brandBlock}>
          <div className={styles.brandCopy}>
            <TradeKeysLogo
              className={styles.brandLogo}
              compact={effectiveCollapsed && viewportMode !== "mobile"}
            />
            <div className={styles.tagline}>Twin-native market terminal</div>
          </div>
          <button
            type="button"
            className={styles.toggle}
            onClick={() => setCollapsed((current) => !current)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <UiIcon
              name={collapsed ? "arrow-right" : "arrow-left"}
              className={styles.toggleIcon}
            />
          </button>
        </div>

        <nav className={styles.nav}>
          {links.map((link) => {
            const active = pathname === link.href
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`${styles.navLink} ${active ? styles.navActive : ""}`}
              >
                <UiIcon name={link.icon} className={styles.icon} />
                <span className={styles.label}>{link.label}</span>
              </Link>
            )
          })}
        </nav>

        <div className={styles.spacer} />

        <div className={styles.ctaWrap}>
          <a
            className={styles.cta}
            href="https://www.twin.fun/twins/launch"
            target="_blank"
            rel="noopener noreferrer"
          >
            Create Twins
          </a>
        </div>

        <div className={styles.footer}>
          <a
            className={styles.footerLink}
            href="https://x.com/pipsandbills"
            target="_blank"
            rel="noopener noreferrer"
          >
            <UiIcon name="help" className={styles.icon} />
            <span className={styles.footerLabel}>Support</span>
          </a>
          <a className={styles.footerLink} href="#">
            <UiIcon name="code" className={styles.icon} />
            <span className={styles.footerLabel}>API</span>
          </a>
        </div>
      </aside>
    </>
  )
}
