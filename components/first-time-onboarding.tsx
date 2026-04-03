"use client"

import Image, { type StaticImageData } from "next/image"
import { usePathname } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { TradeKeysLogo } from "@/components/tradekeys-logo"
import { UiIcon } from "@/components/ui-icon"
import accessScreen from "@/ui/onboarding/screen(1).png"
import styles from "./first-time-onboarding.module.css"

const ONBOARDING_STORAGE_KEY = "tradekeys.onboarding.v1.dismissed"

type OnboardingStep = {
  id: string
  eyebrow: string
  title: string
  summary: string
  bullets: string[]
  image: string | StaticImageData
  imageLabel: string
  accent: "primary" | "secondary"
  footer?: string
}

const STEPS: OnboardingStep[] = [
  {
    id: "welcome",
    eyebrow: "System Initialization",
    title: "Discover digital twins faster",
    summary:
      "TradeKeys is a Twin.fun-native trading terminal built to compress discovery into one workflow. Search, launches, flow, and AI context are brought together so you can find setups without bouncing across multiple pages.",
    bullets: [
      "Search twins by name or ID from anywhere in the terminal.",
      "Scan live opportunities, fresh launches, and watchlist flow in one view.",
      "Open twin pages for holders, recent trades, and chart context without losing pace.",
    ],
    image: "/onboarding/first slide.png",
    imageLabel: "TradeKeys discovery terminal overview",
    accent: "primary",
    footer: "TradeKeys is optimized for discovery first, then decision speed.",
  },
  {
    id: "access",
    eyebrow: "Twin Utility And Execution",
    title: "Trade keys here. Use their benefit on Twin.fun",
    summary:
      "The keys you buy on TradeKeys are the same twin keys used across Twin.fun. Holding keys can unlock twin-specific access there, while price still moves on a bonding curve that reacts to buying and selling.",
    bullets: [
      "Buy on TradeKeys, then use the key utility on Twin.fun where that twin supports access.",
      "Buys and sells move price because the bonding curve reacts to supply.",
      "Discovery comes from terminal context, but execution still uses the live quote before you sign.",
    ],
    image: accessScreen,
    imageLabel: "TradeKeys watchlist and key access context",
    accent: "secondary",
    footer:
      "TradeKeys helps you discover and decide faster. Twin.fun is where twin-key utility lives.",
  },
]

export function FirstTimeOnboarding() {
  const pathname = usePathname()
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) {
      return
    }

    if (pathname.startsWith("/admin")) {
      setOpen(false)
      return
    }

    try {
      const dismissed = window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === "1"
      setOpen(!dismissed)
    } catch {
      setOpen(true)
    }
  }, [mounted, pathname])

  useEffect(() => {
    if (!open) {
      return
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dismissOnboarding()
      }
      if (event.key === "ArrowRight" && stepIndex < STEPS.length - 1) {
        setStepIndex((current) => current + 1)
      }
      if (event.key === "ArrowLeft" && stepIndex > 0) {
        setStepIndex((current) => current - 1)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [open, stepIndex])

  const step = useMemo(() => STEPS[stepIndex] ?? STEPS[0], [stepIndex])
  const progressWidth = `${((stepIndex + 1) / STEPS.length) * 100}%`

  function dismissOnboarding() {
    try {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "1")
    } catch {
      // ignore storage access failure
    }
    setOpen(false)
  }

  if (!mounted || !open) {
    return null
  }

  const accessVisual =
    step.id === "access" ? (
      <div className={styles.accessVisual}>
        <div className={styles.accessVisualPattern} aria-hidden="true" />
        <div className={styles.accessDiagram}>
          <div className={styles.accessState}>
            <div className={styles.accessStateHead}>
              <div className={`${styles.accessIconTile} ${styles.accessIconTileLocked}`}>
                <UiIcon name="lock" className={styles.accessStateIcon} />
              </div>
              <div>
                <h3>0 Keys Held</h3>
                <p>Restricted environment</p>
              </div>
            </div>
            <div className={styles.accessGridMuted}>
              <span />
              <span />
              <span />
              <span />
            </div>
          </div>

          <div className={styles.accessConnector} aria-hidden="true" />

          <div className={styles.accessState}>
            <div className={styles.accessStateGlow} />
            <div className={styles.accessStateHead}>
              <div className={`${styles.accessIconTile} ${styles.accessIconTileUnlocked}`}>
                <UiIcon name="key" className={styles.accessStateIcon} />
              </div>
              <div>
                <h3 className={styles.accessStatePositive}>1+ Keys Detected</h3>
                <p>Twin access authorized</p>
              </div>
            </div>
            <div className={styles.accessGridLive}>
              <span>
                <UiIcon name="spark" className={styles.accessGridIcon} />
              </span>
              <span>
                <UiIcon name="list" className={styles.accessGridIcon} />
              </span>
              <span>
                <UiIcon name="brain" className={styles.accessGridIcon} />
              </span>
              <span>
                <UiIcon name="shield" className={styles.accessGridIcon} />
              </span>
            </div>
          </div>
        </div>
      </div>
    ) : null

  const isWelcomeVisual = step.id === "welcome"
  const isAccessSlide = step.id === "access"

  return (
    <div className={styles.overlay} role="presentation">
      <section
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tradekeys-onboarding-title"
      >
        <button
          type="button"
          className={styles.closeButton}
          onClick={dismissOnboarding}
          aria-label="Close onboarding"
        >
          <UiIcon name="close" className={styles.closeIcon} />
        </button>

        <div className={styles.visualPanel}>
          <div
            className={`${styles.visualGlow} ${
              step.accent === "secondary" ? styles.visualGlowSecondary : ""
            }`}
          />
          <div className={styles.visualMeta}>
            <TradeKeysLogo className={styles.visualLogo} compact />
            <span>
              Step {stepIndex + 1} / {STEPS.length}
            </span>
          </div>
          {accessVisual ? (
            accessVisual
          ) : (
            <div
              className={`${styles.visualFrame} ${isWelcomeVisual ? styles.visualFrameWelcome : ""}`}
            >
              <div className={styles.visualFrameHead}>
                <span>{step.imageLabel}</span>
                <div className={styles.visualDots}>
                  <span />
                  <span />
                  <span />
                </div>
              </div>
              <div
                className={`${styles.visualImageWrap} ${
                  isWelcomeVisual ? styles.visualImageWrapWelcome : ""
                }`}
              >
                {typeof step.image === "string" ? (
                  <img
                    src={step.image}
                    alt={step.imageLabel}
                    className={`${styles.visualImage} ${
                      isWelcomeVisual ? styles.visualImageWelcome : ""
                    }`}
                  />
                ) : (
                  <Image
                    src={step.image}
                    alt={step.imageLabel}
                    className={`${styles.visualImage} ${
                      isWelcomeVisual ? styles.visualImageWelcome : ""
                    }`}
                    placeholder="blur"
                    priority={stepIndex === 0}
                  />
                )}
              </div>
              <div className={styles.visualFooter}>
                <span>{step.footer}</span>
              </div>
            </div>
          )}
        </div>

        <div className={`${styles.copyPanel} ${isAccessSlide ? styles.copyPanelAccess : ""}`}>
          <div className={`${styles.copyInner} ${isAccessSlide ? styles.copyInnerAccess : ""}`}>
            <div className={styles.headerBlock}>
              <span className={styles.eyebrow}>{step.eyebrow}</span>
              <h1
                id="tradekeys-onboarding-title"
                className={`${styles.title} ${isAccessSlide ? styles.titleAccess : ""}`}
              >
                {step.title}
              </h1>
              <p className={`${styles.summary} ${isAccessSlide ? styles.summaryAccess : ""}`}>
                {step.summary}
              </p>
            </div>

            <div className={`${styles.bulletList} ${isAccessSlide ? styles.bulletListAccess : ""}`}>
              {step.bullets.map((bullet) => (
                <div key={bullet} className={styles.bulletRow}>
                  <span
                    className={`${styles.bulletIconWrap} ${
                      step.accent === "secondary" ? styles.bulletIconWrapSecondary : ""
                    }`}
                  >
                    <UiIcon
                      name={step.accent === "secondary" ? "spark" : "shield"}
                      className={styles.bulletIcon}
                    />
                  </span>
                  <p>{bullet}</p>
                </div>
              ))}
            </div>

            <div className={styles.navigationMap}>
              <span className={styles.navigationLabel}>Terminal lanes</span>
              <div className={styles.navigationChips}>
                <span>Home</span>
                <span>Watchlist</span>
                <span>Portfolio</span>
                <span>AI Copilot</span>
              </div>
            </div>

          </div>

          <div className={styles.footerBlock}>
            <div className={styles.progressTrack} aria-hidden="true">
              <div className={styles.progressFill} style={{ width: progressWidth }} />
            </div>

            <div className={styles.footerActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => {
                  if (stepIndex === 0) {
                    dismissOnboarding()
                    return
                  }
                  setStepIndex((current) => current - 1)
                }}
              >
                {stepIndex === 0 ? "Skip for now" : "Back"}
              </button>

              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => {
                  if (stepIndex === STEPS.length - 1) {
                    dismissOnboarding()
                    return
                  }
                  setStepIndex((current) => current + 1)
                }}
              >
                {stepIndex === STEPS.length - 1 ? "Enter Terminal" : "Next Step"}
                <UiIcon name="arrow-right" className={styles.primaryButtonIcon} />
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
