"use client"

import { useEffect, useMemo, useState } from "react"
import { createPublicClient, createWalletClient, custom } from "viem"
import { bsc } from "viem/chains"
import { formatUsd } from "@/lib/currency"
import { sendClientTelemetry } from "@/lib/client-telemetry"
import contractAbi from "@/lib/contracts/abis/DigitalTwinSharesV1.json"
import networks from "@/lib/contracts/networks.json"
import { useWallet } from "@/components/wallet-provider"
import {
  buildRequotePrompt,
  didTwinQuoteChange,
  getWalletExecutionState,
  isQuoteExpired,
  mapExecutionError,
  type ExecutionUiFeedback,
} from "@/lib/trade-safety"
import type { TwinQuote } from "@/lib/types"
import styles from "@/components/trade-panel.module.css"

type Props = {
  twinId: string
  initialQuote: TwinQuote
  referencePriceUsd?: number
  browseDataWarning?: string
}

type Side = "buy" | "sell"

type WalletBalancePayload = {
  wei: string
  bnb: number
  usd: number
  error?: string
}

const contractAddress = networks.bsc.DigitalTwinSharesV1.address as `0x${string}`
const bscChainId = bsc.id

type ExecutionPreflightPayload = {
  quote: TwinQuote
}

export function TradePanel({
  twinId,
  initialQuote,
  referencePriceUsd,
  browseDataWarning,
}: Props) {
  const { account, chainId, connect, connecting, error: walletError } = useWallet()
  const [side, setSide] = useState<Side>("buy")
  const [amount, setAmount] = useState(initialQuote.amount)
  const [quote, setQuote] = useState<TwinQuote>(initialQuote)
  const [loadingQuote, setLoadingQuote] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [tradeError, setTradeError] = useState<string | null>(null)
  const [tradeWarning, setTradeWarning] = useState<ExecutionUiFeedback | null>(null)
  const [tradeSuccess, setTradeSuccess] = useState<string | null>(null)
  const [walletBalance, setWalletBalance] = useState<WalletBalancePayload | null>(null)
  const [loadingBalance, setLoadingBalance] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function run() {
      if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) {
        return
      }

      setLoadingQuote(true)
      setTradeError(null)
      setTradeWarning(null)
      try {
        const query = new URLSearchParams({ amount })
        if (account) query.set("wallet", account)
        const response = await fetch(`/api/twins/${encodeURIComponent(twinId)}/quote?${query.toString()}`, {
          cache: "no-store",
        })
        const payload = (await response.json()) as TwinQuote | { error?: string }
        if (!response.ok) {
          throw new Error("error" in payload && payload.error ? payload.error : "Quote request failed")
        }
        if (!cancelled) {
          setQuote(payload as TwinQuote)
        }
      } catch (error) {
        if (!cancelled) {
          setTradeError(mapExecutionError(side, error).body)
        }
      } finally {
        if (!cancelled) {
          setLoadingQuote(false)
        }
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [account, amount, twinId])

  useEffect(() => {
    let cancelled = false

    async function run() {
      if (!account) {
        setWalletBalance(null)
        return
      }

      setLoadingBalance(true)
      try {
        const response = await fetch(
          `/api/wallet/balance?account=${encodeURIComponent(account)}`,
          { cache: "no-store" }
        )
        const payload = (await response.json()) as WalletBalancePayload
        if (!response.ok) {
          throw new Error(payload.error || "Wallet balance unavailable.")
        }
        if (!cancelled) {
          setWalletBalance(payload)
        }
      } catch {
        if (!cancelled) {
          setWalletBalance(null)
        }
      } finally {
        if (!cancelled) {
          setLoadingBalance(false)
        }
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [account, tradeSuccess])

  const amountValue = /^\d+$/.test(amount) ? Number(amount) : 0
  const totalUsd = Number(side === "buy" ? quote.buyQuoteUsd : quote.sellQuoteUsd)
  const perKeyUsd = amountValue > 0 ? totalUsd / amountValue : totalUsd
  const hasReferencePrice = typeof referencePriceUsd === "number" && referencePriceUsd > 0
  const spreadUsd = hasReferencePrice ? perKeyUsd - referencePriceUsd : 0
  const spreadPct = hasReferencePrice && referencePriceUsd > 0 ? (spreadUsd / referencePriceUsd) * 100 : 0
  const holderBalanceLabel = quote.holderBalance ? `${quote.holderBalance} keys` : null
  const quoteExpired = isQuoteExpired(quote)
  const hasInsufficientBalance = Boolean(
    side === "buy" &&
      walletBalance?.wei &&
      BigInt(walletBalance.wei) < BigInt(quote.buyQuoteWei)
  )
  const executionState = useMemo(
    () =>
      getWalletExecutionState({
        account,
        chainId,
        connecting,
        browseDataWarning,
      }),
    [account, browseDataWarning, chainId, connecting]
  )

  async function requestExecutionPreflight() {
    const response = await fetch("/api/execution/preflight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        action: side,
        twinId,
        amount,
        ...(account ? { wallet: account } : {}),
      }),
    })
    const payload = (await response.json()) as ExecutionPreflightPayload | { error?: string }
    if (!response.ok || !("quote" in payload)) {
      throw new Error("error" in payload && payload.error ? payload.error : "Execution preflight failed.")
    }
    return payload.quote
  }

  async function executeTrade() {
    setTradeError(null)
    setTradeWarning(null)
    setTradeSuccess(null)

    if (!window.ethereum) {
      setTradeError(mapExecutionError(side, new Error("A browser wallet is required to trade here.")).body)
      return
    }
    if (!account) {
      await connect()
      return
    }

    if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) {
      setTradeError(mapExecutionError(side, new Error("Amount must be a positive whole number.")).body)
      return
    }

    setSubmitting(true)
    try {
      if (chainId !== bscChainId) {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x38" }],
        })
      }

      const nextQuote = await requestExecutionPreflight()
      if (quoteExpired || didTwinQuoteChange(quote, nextQuote)) {
        setQuote(nextQuote)
        setTradeWarning(buildRequotePrompt(side))
        return
      }

      const walletClient = createWalletClient({
        chain: bsc,
        transport: custom(window.ethereum),
      })

      const publicClient = createPublicClient({
        chain: bsc,
        transport: custom(window.ethereum),
      })

      const amountBigInt = BigInt(amount)
      const [address] = await walletClient.getAddresses()

      if (side === "buy") {
        const hash = await walletClient.writeContract({
          address: contractAddress,
          abi: contractAbi,
          functionName: "buyShares",
          args: [twinId as `0x${string}`, amountBigInt],
          account: address,
          chain: bsc,
          value: BigInt(nextQuote.buyQuoteWei),
        })
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        setTradeSuccess(`Buy confirmed: ${receipt.transactionHash.slice(0, 10)}...`)
      } else {
        const hash = await walletClient.writeContract({
          address: contractAddress,
          abi: contractAbi,
          functionName: "sellShares",
          args: [twinId as `0x${string}`, amountBigInt],
          account: address,
          chain: bsc,
        })
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        setTradeSuccess(`Sell confirmed: ${receipt.transactionHash.slice(0, 10)}...`)
      }
    } catch (error) {
      sendClientTelemetry({
        name: "transaction_submission_failure",
        message: error instanceof Error ? error.message : "Trade submission failed.",
        data: { flow: "trade-panel", side, twinId },
      })
      setTradeError(mapExecutionError(side, error).body)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.tabRow}>
        <button
          type="button"
          className={`${styles.tabButton} ${side === "buy" ? styles.tabButtonActive : ""}`}
          onClick={() => setSide("buy")}
        >
          Buy Keys
        </button>
        <button
          type="button"
          className={`${styles.tabButton} ${side === "sell" ? styles.tabButtonActive : ""}`}
          onClick={() => setSide("sell")}
        >
          Sell Keys
        </button>
      </div>

      <div className={styles.body}>
        <label className={styles.label}>
          Amount of Keys
          <div className={styles.inputShell}>
            <input
              className={styles.input}
              inputMode="numeric"
              value={amount}
              onChange={(event) => setAmount(event.target.value.replace(/[^\d]/g, "") || "0")}
            />
            <span className={styles.inputSuffix}>Keys</span>
          </div>
        </label>

        <div
          className={`${styles.statusCard} ${
            executionState.tone === "ready" ? styles.statusCardReady : styles.statusCardWarning
          }`}
        >
          <strong>{executionState.headline}</strong>
        </div>

        <div className={styles.quoteCard}>
          {hasReferencePrice ? (
            <div className={styles.referenceBlock}>
              <div className={styles.quoteRow}>
                <span>Last traded price</span>
                <strong>{formatUsd(referencePriceUsd)}</strong>
              </div>
              <div className={styles.quoteRow}>
                <span>{side === "buy" ? "Execution premium" : "Execution spread"}</span>
                <strong className={spreadUsd >= 0 ? styles.spreadWarning : styles.spreadPositive}>
                  {spreadUsd >= 0 ? "+" : "-"}
                  {formatUsd(Math.abs(spreadUsd))} ({spreadPct >= 0 ? "+" : ""}
                  {spreadPct.toFixed(1)}%)
                </strong>
              </div>
            </div>
          ) : null}
          <div className={styles.quoteRow}>
            <span>{side === "buy" ? "Executable total (USD display)" : "Executable proceeds (USD display)"}</span>
            <strong>{formatUsd(totalUsd)}</strong>
          </div>
          <div className={styles.quoteRow}>
            <span>{side === "buy" ? "Executable buy per key (USD display)" : "Executable sell per key (USD display)"}</span>
            <strong>{formatUsd(perKeyUsd)}</strong>
          </div>
          <div className={styles.quoteRow}>
            <span>Creator fee share</span>
            <strong>{quote.feeSharePct}%</strong>
          </div>
          {holderBalanceLabel ? (
            <div className={styles.quoteRow}>
              <span>Your keys</span>
              <strong>{holderBalanceLabel}</strong>
            </div>
          ) : null}
          <div className={styles.quoteTotal}>
            <span>{side === "buy" ? "Submit buy" : "Submit sell"}</span>
            <strong>{formatUsd(totalUsd)}</strong>
          </div>
        </div>

        <button
          className={styles.primaryButton}
          type="button"
          onClick={() => void executeTrade()}
          disabled={submitting || connecting || hasInsufficientBalance}
        >
          {submitting
            ? "Submitting..."
            : account
              ? `${side === "buy" ? "Buy" : "Sell"} Keys`
              : "Connect Wallet"}
        </button>

        <div className={styles.balanceRow}>
          <span>Available</span>
          <strong>
            {loadingBalance
              ? "Loading..."
              : walletBalance
                ? formatUsd(walletBalance.usd)
                : account
                  ? "Unavailable"
                  : "Connect wallet"}
          </strong>
        </div>

        <p className={styles.note}>
          Executable quotes come from the live contract curve and can differ from the last traded price shown on the chart. USD values use the current BNB conversion, while settlement still happens onchain in BNB.
        </p>
        {quoteExpired ? (
          <p className={styles.warning}>
            Displayed quote expired. The next submit will refresh the live quote before signing.
          </p>
        ) : null}

        {(walletError || tradeError || hasInsufficientBalance) ? (
          <p className={styles.error}>
            {hasInsufficientBalance
              ? "Available balance is below the current buy quote."
              : walletError || tradeError}
          </p>
        ) : null}
        {tradeWarning ? <p className={styles.warning}>{tradeWarning.body}</p> : null}
        {tradeSuccess ? <p className={styles.success}>{tradeSuccess}</p> : null}
        {loadingQuote ? <p className={styles.note}>Refreshing quote...</p> : null}
      </div>
    </section>
  )
}
