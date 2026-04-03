"use client"

import Link from "next/link"
import { useState } from "react"
import { createPublicClient, createWalletClient, custom } from "viem"
import { bsc } from "viem/chains"
import contractAbi from "@/twin/abis/DigitalTwinSharesV1.json"
import networks from "@/twin/networks.json"
import { useQuickBuySettings } from "@/components/quick-buy-settings-provider"
import { useWallet } from "@/components/wallet-provider"
import { startActionFeedback, stopActionFeedback } from "@/lib/action-feedback"
import { sendClientTelemetry } from "@/lib/client-telemetry"
import {
  mapExecutionError,
  type ExecutionUiFeedback,
} from "@/lib/trade-safety"
import styles from "./quick-buy-control.module.css"

type Props = {
  twinId: string
  variant?: "featured" | "table" | "card"
  buttonLabel?: string
  onExpandedChange?: (expanded: boolean) => void
  browseDataWarning?: string
}

const contractAddress = networks.bsc.DigitalTwinSharesV1.address as `0x${string}`

type QuoteResponse = {
  quote: {
    buyQuoteWei: string
  }
}

export function QuickBuyControl({
  twinId,
  variant = "featured",
  buttonLabel,
  onExpandedChange,
  browseDataWarning,
}: Props) {
  const { account, chainId, connect, connecting } = useWallet()
  const { quickBuyAmount } = useQuickBuySettings()
  const [expanded, setExpanded] = useState(false)
  const [amount, setAmount] = useState("1")
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<ExecutionUiFeedback | null>(null)
  const [showSettingsPrompt, setShowSettingsPrompt] = useState(false)

  const isFeatured = variant === "featured"
  const isTable = variant === "table"
  const isCard = variant === "card"
  const presetAmount = quickBuyAmount ? String(quickBuyAmount) : null
  const triggerLabel = submitting
    ? "Buying..."
    : !account
      ? "Connect Wallet"
      : buttonLabel ?? (isFeatured ? "Buy Keys" : isCard ? "Quick Buy" : "Buy")

  async function executeBuy(requestedAmount: string) {
    setFeedback(null)

    if (!/^\d+$/.test(requestedAmount) || BigInt(requestedAmount) <= 0n) {
      setFeedback(mapExecutionError("buy", new Error("amount must be greater than zero")))
      return
    }

    if (!window.ethereum) {
      setFeedback(mapExecutionError("buy", new Error("A browser wallet is required.")))
      return
    }

    if (!account) {
      await connect()
      return
    }

    setSubmitting(true)
    startActionFeedback({ label: "Submitting buy", persistent: true })

    try {
      if (chainId !== bsc.id) {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x38" }],
        })
      }

      const quoteResponse = await fetch("/api/execution/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          action: "buy",
          twinId,
          amount: requestedAmount,
          wallet: account,
        }),
      })
      const quotePayload = (await quoteResponse.json()) as QuoteResponse | { error?: string }

      if (!quoteResponse.ok || !("quote" in quotePayload)) {
        throw new Error(
          "error" in quotePayload && quotePayload.error
            ? quotePayload.error
            : "Failed to fetch the latest buy quote."
        )
      }

      const walletClient = createWalletClient({
        chain: bsc,
        transport: custom(window.ethereum),
      })
      const publicClient = createPublicClient({
        chain: bsc,
        transport: custom(window.ethereum),
      })
      const [address] = await walletClient.getAddresses()
      const amountBigInt = BigInt(requestedAmount)

      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: contractAbi,
        functionName: "buyShares",
        args: [twinId as `0x${string}`, amountBigInt],
        account: address,
        chain: bsc,
        value: BigInt(quotePayload.quote.buyQuoteWei),
      })

      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      setFeedback({
        tone: "success",
        title: "Buy confirmed",
        body: `${requestedAmount} key${requestedAmount === "1" ? "" : "s"} purchased successfully. Tx ${receipt.transactionHash.slice(0, 10)}...`,
      })
      setExpanded(false)
      onExpandedChange?.(false)
    } catch (cause) {
      sendClientTelemetry({
        name: "transaction_submission_failure",
        message: cause instanceof Error ? cause.message : "Quick buy transaction failed.",
        data: { flow: "quick-buy", twinId },
      })
      setFeedback(mapExecutionError("buy", cause))
    } finally {
      setSubmitting(false)
      stopActionFeedback()
    }
  }

  async function handleTriggerClick() {
    if (!account) {
      await connect()
      return
    }

    if (isCard) {
      if (!presetAmount) {
        setShowSettingsPrompt(true)
        return
      }

      await executeBuy(presetAmount)
      return
    }

    setExpanded(true)
    onExpandedChange?.(true)
  }

  return (
    <div
      className={`${styles.wrap} ${
        isFeatured ? styles.featured : isTable ? styles.table : styles.card
      }`}
    >
      {!expanded ? (
        <button
          type="button"
          className={`${styles.trigger} ${
            isFeatured
              ? styles.triggerFeatured
              : isCard
                ? styles.triggerCard
                : styles.triggerTable
          }`}
          onClick={() => void handleTriggerClick()}
          disabled={submitting || connecting}
        >
          {triggerLabel}
        </button>
      ) : (
        <>
          <div className={`${styles.entry} ${isFeatured ? styles.entryFeatured : styles.entryTable}`}>
            <input
              className={styles.input}
              inputMode="numeric"
              value={amount}
              onChange={(event) => setAmount(event.target.value.replace(/[^\d]/g, "") || "0")}
              aria-label="Amount to buy"
              placeholder="Amount"
            />
            <button
              type="button"
              className={styles.submit}
              onClick={() => void executeBuy(amount)}
              disabled={submitting || connecting}
              aria-label={account ? "Submit buy" : "Connect wallet"}
              title={account ? "Submit buy" : "Connect wallet"}
            >
              {submitting ? "..." : account ? ">" : "^"}
            </button>
            <button
              type="button"
              className={styles.collapse}
              onClick={() => {
                setExpanded(false)
                onExpandedChange?.(false)
              }}
              aria-label="Close amount entry"
              title="Close amount entry"
            >
              x
            </button>
          </div>
          <div className={styles.helper}>
            {account
              ? "Enter key amount, then submit using a fresh live BNB quote. Any USD shown elsewhere is display-only."
              : "Enter amount, then connect wallet to continue."}
          </div>
        </>
      )}

      {feedback ? (
        <div
          className={`${styles.feedback} ${
            feedback.tone === "success"
              ? styles.feedbackSuccess
              : feedback.tone === "warning"
                ? styles.feedbackWarning
                : styles.feedbackError
          }`}
          role={feedback.tone === "error" ? "alert" : "status"}
        >
          <div className={styles.feedbackHead}>
            <strong>{feedback.title}</strong>
            <button
              type="button"
              className={styles.dismiss}
              onClick={() => setFeedback(null)}
              aria-label="Clear feedback"
              title="Clear feedback"
            >
              x
            </button>
          </div>
          <p>{feedback.body}</p>
        </div>
      ) : null}

      {showSettingsPrompt ? (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
          <div className={styles.modalCard}>
            <strong>Set quick buy amount first</strong>
            <p>
              Quick buy needs a saved amount before it can place a one-click order. Set it in
              Settings now, and you can change it there any time.
            </p>
            <div className={styles.modalActions}>
              <Link
                href="/settings/featured#quick-buy-settings"
                className={styles.modalPrimary}
                onClick={() => setShowSettingsPrompt(false)}
              >
                Open Settings
              </Link>
              <button
                type="button"
                className={styles.modalSecondary}
                onClick={() => setShowSettingsPrompt(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
