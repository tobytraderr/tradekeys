"use client"

import { useState } from "react"
import { useWallet } from "@/components/wallet-provider"
import { useQuickBuySettings } from "@/components/quick-buy-settings-provider"

export function QuickBuySettingsForm() {
  const { account, connect, connecting } = useWallet()
  const { quickBuyAmount, save, loading, error } = useQuickBuySettings()
  const [amount, setAmount] = useState(quickBuyAmount ? String(quickBuyAmount) : "")
  const [success, setSuccess] = useState<string | null>(null)

  async function handleSave() {
    setSuccess(null)
    const trimmed = amount.trim()
    const nextAmount = trimmed ? Number(trimmed) : null

    if (
      trimmed &&
      (typeof nextAmount !== "number" || !Number.isInteger(nextAmount) || nextAmount <= 0)
    ) {
      return
    }

    await save(nextAmount)
    setSuccess(
      typeof nextAmount === "number"
        ? `Quick buy amount saved at ${nextAmount} key${nextAmount === 1 ? "" : "s"}.`
        : "Quick buy amount cleared."
    )
  }

  return (
    <section className="panel" style={{ padding: 24 }} id="quick-buy-settings">
      <h2 className="section-title" style={{ fontSize: "2.4rem" }}>Quick Buy Settings</h2>
      <p className="section-subtitle">Set the one-click amount used by dashboard quick buys</p>
      {!account ? (
        <div className="stack">
          <div className="muted">
            Connect your wallet to store a quick buy amount in the database.
          </div>
          <button
            className="btn-primary"
            type="button"
            onClick={() => void connect()}
            disabled={connecting}
            style={{ width: "fit-content" }}
          >
            {connecting ? "Connecting..." : "Connect Wallet"}
          </button>
        </div>
      ) : (
        <div className="stack">
          <label className="stat-label" htmlFor="quick-buy-amount">Quick Buy Amount</label>
          <input
            id="quick-buy-amount"
            className="search"
            value={amount}
            onChange={(event) => setAmount(event.target.value.replace(/[^\d]/g, ""))}
            inputMode="numeric"
            placeholder="e.g. 3"
          />
          <div className="muted">
            This amount is used when you hit quick buy on dashboard cards. You can change it here any time.
          </div>
          {error ? <p className="danger">{error}</p> : null}
          {success ? <p className="ticker">{success}</p> : null}
          <div className="featured-actions">
            <button
              className="btn-primary"
              type="button"
              onClick={() => void handleSave()}
              disabled={loading}
            >
              {loading ? "Saving..." : "Save Amount"}
            </button>
            <button
              className="btn-secondary"
              type="button"
              onClick={() => {
                setAmount("")
                void save(null)
              }}
              disabled={loading}
            >
              Clear Amount
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
