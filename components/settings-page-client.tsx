"use client"

import { useEffect, useMemo, useState } from "react"
import { UiIcon } from "@/components/ui-icon"
import { useQuickBuySettings } from "@/components/quick-buy-settings-provider"
import { useWallet } from "@/components/wallet-provider"
import styles from "./settings-page-client.module.css"

const BSC_CHAIN_ID = 56

type SecuritySection = {
  title: string
  items: string[]
}

const SECURITY_SECTIONS: SecuritySection[] = [
  {
    title: "What we do",
    items: [
      "Use explicit browser-wallet connection through an EIP-1193 provider.",
      "Fetch live execution quotes from contract reads before buy and sell actions.",
      "Validate wallet accounts and quick-buy amounts on the server before saving settings.",
      "Ship browser security headers such as CSP, X-Frame-Options, and Referrer-Policy.",
    ],
  },
  {
    title: "What we do not do",
    items: [
      "We do not ask for your private key or seed phrase in the TradeKeys interface.",
      "We do not let AI make hidden execution decisions on your behalf.",
      "We do not execute trades from indexed subgraph prices.",
      "We do not store personal identity data as part of quick-buy preferences.",
    ],
  },
  {
    title: "Data handling right now",
    items: [
      "Quick-buy amount is stored per wallet account in the app database.",
      "Some lightweight interface state, such as sidebar collapse or recent UI history, may be stored in your browser.",
      "Wallet connection itself stays with your browser wallet; disconnecting in TradeKeys only clears the app session state.",
    ],
  },
]

function shortenAddress(value: string) {
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value
}

function getWalletStatus(account: string | null, chainId: number | null) {
  if (!account) {
    return {
      headline: "Wallet disconnected",
      detail: "Connect your wallet to save trading preferences for this account.",
      toneClass: styles.statusNeutral,
      dotClass: styles.statusDotNeutral,
      networkLabel: "Awaiting wallet",
    }
  }

  if (chainId === BSC_CHAIN_ID) {
    return {
      headline: "Wallet connected",
      detail: "TradeKeys is connected to your wallet on BNB Smart Chain.",
      toneClass: styles.statusLive,
      dotClass: styles.statusDotLive,
      networkLabel: "BNB Smart Chain",
    }
  }

  return {
    headline: "Wallet connected, network mismatch",
    detail: "Switch to BNB Smart Chain before using quick buy or live execution flows.",
    toneClass: styles.statusWarning,
    dotClass: styles.statusDotWarning,
    networkLabel: chainId ? `Chain ${chainId}` : "Unknown network",
  }
}

export function SettingsPageClient() {
  const { account, chainId, connect, disconnect, connecting } = useWallet()
  const { quickBuyAmount, save, loading, hydrated, error } = useQuickBuySettings()
  const [amount, setAmount] = useState(quickBuyAmount ? String(quickBuyAmount) : "")
  const [success, setSuccess] = useState<string | null>(null)
  const [securityOpen, setSecurityOpen] = useState(false)

  const walletStatus = useMemo(() => getWalletStatus(account, chainId), [account, chainId])

  useEffect(() => {
    setAmount(quickBuyAmount ? String(quickBuyAmount) : "")
  }, [quickBuyAmount, account])

  async function handleSave(nextAmount: number | null) {
    setSuccess(null)
    try {
      await save(nextAmount)
      setSuccess(
        typeof nextAmount === "number"
          ? `Quick buy amount saved at ${nextAmount} key${nextAmount === 1 ? "" : "s"}.`
          : "Quick buy amount cleared."
      )
    } catch {
      // provider already exposes error state
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div>
          <h1 className={styles.title}>Settings</h1>
          <p className={styles.subtitle}>Wallet-linked preferences</p>
        </div>
      </header>

      <div className={styles.workspace}>
        <section className={styles.main}>
          <section className={styles.primaryPanel}>
            <div className={styles.panelHead}>
              <div>
                <h2 className={styles.panelTitle}>Quick Buy Settings</h2>
                <p className={styles.panelCopy}>
                  Customize the preset execution size for instant trading. This powers one-click
                  buys across the terminal.
                </p>
              </div>
              <div className={styles.panelIconWrap}>
                <UiIcon name="spark" className={styles.panelIcon} />
              </div>
            </div>

            {!account ? (
              <div className={styles.emptyState}>
                <p>Connect your wallet to save a quick-buy amount for this account.</p>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => void connect()}
                  disabled={connecting}
                >
                  {connecting ? "Connecting..." : "Connect wallet"}
                </button>
              </div>
            ) : (
              <div className={styles.formStack}>
                <label className={styles.inputLabel} htmlFor="quick-buy-amount">
                  Quick Buy Amount (Keys)
                </label>
                <div className={styles.inputRow}>
                  <input
                    id="quick-buy-amount"
                    className={styles.amountInput}
                    value={amount}
                    onChange={(event) => {
                      setAmount(event.target.value.replace(/[^\d]/g, ""))
                      setSuccess(null)
                    }}
                    inputMode="numeric"
                    placeholder={hydrated && quickBuyAmount ? String(quickBuyAmount) : "1"}
                  />
                  <span className={styles.inputSuffix}>Keys</span>
                </div>
                <p className={styles.helper}>
                  {hydrated
                    ? "Saved per connected wallet. This amount is used when you hit quick buy on product cards and terminal surfaces."
                    : "Loading the saved quick-buy amount for this wallet."}
                </p>
                {error ? <p className={styles.error}>{error}</p> : null}
                {success ? <p className={styles.success}>{success}</p> : null}
                <div className={styles.actionRow}>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() => {
                      const trimmed = amount.trim()
                      const nextAmount = trimmed ? Number(trimmed) : null

                      if (
                        trimmed &&
                        (typeof nextAmount !== "number" ||
                          !Number.isInteger(nextAmount) ||
                          nextAmount <= 0)
                      ) {
                        return
                      }

                      void handleSave(nextAmount)
                    }}
                    disabled={loading}
                  >
                    {loading ? "Saving..." : "Save Amount"}
                  </button>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => {
                      setAmount("")
                      void handleSave(null)
                    }}
                    disabled={loading}
                  >
                    Clear Amount
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className={styles.roadmapSection}>
            <div className={styles.roadmapHead}>
              <UiIcon name="settings" className={styles.roadmapIcon} />
              <h3 className={styles.roadmapTitle}>More controls coming</h3>
            </div>
            <div className={styles.roadmapGrid}>
              <article className={styles.lockedCard}>
                <div className={styles.lockedTitle}>Default Trade Sizing</div>
                <div className={styles.lockedState}>Locked</div>
              </article>
              <article className={styles.lockedCard}>
                <div className={styles.lockedTitle}>Execution Preferences</div>
                <div className={styles.lockedState}>Locked</div>
              </article>
              <article className={styles.lockedCard}>
                <div className={styles.lockedTitle}>Watchlist Alerts</div>
                <div className={styles.lockedState}>Locked</div>
              </article>
            </div>
          </section>
        </section>

        <aside className={styles.side}>
          <section className={styles.statusPanel}>
            <div className={styles.statusVisual}>
              <div className={styles.statusPattern} />
              <div className={`${styles.statusChip} ${walletStatus.toneClass}`}>
                <span className={`${styles.statusDot} ${walletStatus.dotClass}`} />
                {walletStatus.headline}
              </div>
            </div>
            <div className={styles.sideContent}>
              <h3 className={styles.sideEyebrow}>Identity Panel</h3>
              <div className={styles.identityCard}>
                <div className={styles.identityTop}>
                  <span>Primary Wallet</span>
                  <UiIcon name="shield" className={styles.identityIcon} />
                </div>
                <strong>{account ? shortenAddress(account) : "No wallet connected"}</strong>
                <small>{walletStatus.networkLabel}</small>
              </div>
              <p className={styles.sideCopy}>{walletStatus.detail}</p>
              <button
                type="button"
                className={styles.disconnectButton}
                onClick={() => (account ? disconnect() : void connect())}
                disabled={connecting}
              >
                {account ? "Disconnect account" : connecting ? "Connecting..." : "Connect wallet"}
              </button>
            </div>
          </section>

          <section className={styles.securityPanel}>
            <div className={styles.securityHead}>
              <UiIcon name="shield" className={styles.securityIcon} />
              <h4>Terminal Security</h4>
            </div>
            <p className={styles.securityCopy}>
              Wallet connection is explicit, quick-buy preferences are validated server-side, and
              TradeKeys does not ask for your private key in the interface.
            </p>
            <button
              type="button"
              className={styles.securityLink}
              onClick={() => setSecurityOpen(true)}
            >
              Security documentation
            </button>
          </section>
        </aside>
      </div>

      {securityOpen ? (
        <div
          className={styles.modalOverlay}
          role="presentation"
          onClick={() => setSecurityOpen(false)}
        >
          <div
            className={styles.modalCard}
            role="dialog"
            aria-modal="true"
            aria-label="Security documentation"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.modalHead}>
              <div>
                <h2 className={styles.modalTitle}>Security documentation</h2>
                <p className={styles.modalSubtitle}>
                  Product-true notes on what TradeKeys currently does and does not do.
                </p>
              </div>
              <button
                type="button"
                className={styles.modalClose}
                onClick={() => setSecurityOpen(false)}
                aria-label="Close security documentation"
              >
                <UiIcon name="close" className={styles.modalCloseIcon} />
              </button>
            </div>

            <div className={styles.modalGrid}>
              {SECURITY_SECTIONS.map((section) => (
                <section key={section.title} className={styles.modalSection}>
                  <h3>{section.title}</h3>
                  <ul className={styles.modalList}>
                    {section.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
