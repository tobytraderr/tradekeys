"use client"

import Link from "next/link"
import { useEffect, useMemo, useState, useTransition } from "react"
import { createPublicClient, createWalletClient, custom } from "viem"
import { bsc } from "viem/chains"
import { formatUsd } from "@/lib/currency"
import { sendClientTelemetry } from "@/lib/client-telemetry"
import contractAbi from "@/lib/contracts/abis/DigitalTwinSharesV1.json"
import networks from "@/lib/contracts/networks.json"
import { useWallet } from "@/components/wallet-provider"
import {
  buildRequotePrompt,
  didCreateQuoteChange,
  getWalletExecutionState,
  isQuoteExpired,
  mapExecutionError,
  type ExecutionUiFeedback,
} from "@/lib/trade-safety"
import type { TwinCreationQuote } from "@/lib/types"
import styles from "./create-twin-form.module.css"

const contractAddress = networks.bsc.DigitalTwinSharesV1.address as `0x${string}`
const zeroAddress = "0x0000000000000000000000000000000000000000"

type ApiError = {
  error?: string
}

type CreateTwinPreflightPayload = {
  quote: TwinCreationQuote
}

function normalizeTwinId(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ""
  const prefixed = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`
  return prefixed.toLowerCase()
}

function isValidTwinId(value: string) {
  return /^0x[a-f0-9]{32}$/.test(value)
}

function shortenAddress(address: string) {
  return address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address
}

export function CreateTwinForm() {
  const { account, chainId, connect, connecting } = useWallet()
  const [twinIdInput, setTwinIdInput] = useState("")
  const [metadataUrl, setMetadataUrl] = useState("")
  const [quote, setQuote] = useState<TwinCreationQuote | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<ExecutionUiFeedback | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [isPending, startTransition] = useTransition()

  const normalizedTwinId = useMemo(() => normalizeTwinId(twinIdInput), [twinIdInput])
  const twinIdReady = isValidTwinId(normalizedTwinId)
  const canCreate =
    twinIdReady &&
    metadataUrl.trim().length > 0 &&
    quote !== null &&
    !quote.exists &&
    (!quote.isClaimed || quote.owner.toLowerCase() === account?.toLowerCase())

  useEffect(() => {
    setQuote(null)
    setQuoteError(null)

    if (!twinIdReady) {
      return
    }

    let cancelled = false
    startTransition(() => {
      void (async () => {
        try {
          const response = await fetch(
            `/api/twins/create?id=${encodeURIComponent(normalizedTwinId)}`,
            { cache: "no-store" }
          )
          const payload = (await response.json()) as TwinCreationQuote | ApiError
          if (!response.ok) {
            throw new Error("error" in payload && payload.error ? payload.error : "Creation quote unavailable.")
          }

          if (!cancelled) {
            setQuote(payload as TwinCreationQuote)
            setQuoteError(null)
          }
        } catch (error) {
          if (!cancelled) {
            setQuote(null)
            setQuoteError(error instanceof Error ? error.message : "Creation quote unavailable.")
          }
        }
      })()
    })

    return () => {
      cancelled = true
    }
  }, [normalizedTwinId, twinIdReady])

  async function handleCreate() {
    setFeedback(null)

    if (!twinIdReady) {
      setFeedback({
        tone: "error",
        title: "Invalid twin ID",
        body: "Enter a 0x-prefixed bytes16 twin ID before launching.",
      })
      return
    }

    if (!metadataUrl.trim()) {
      setFeedback(mapExecutionError("create", new Error("url is required")))
      return
    }

    if (!window.ethereum) {
      setFeedback(mapExecutionError("create", new Error("A browser wallet is required.")))
      return
    }

    if (!account) {
      await connect()
      return
    }

    if (!quote) {
      setFeedback(mapExecutionError("create", new Error("Failed to fetch the latest creation quote.")))
      return
    }

    if (quote.exists) {
      setFeedback(mapExecutionError("create", new Error("Twin already exists.")))
      return
    }

    if (quote.isClaimed && quote.owner.toLowerCase() !== account.toLowerCase()) {
      setFeedback(mapExecutionError("create", new Error("Owner required for claimed twin.")))
      return
    }

    setSubmitting(true)

    try {
      if (chainId !== bsc.id) {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x38" }],
        })
      }

      const nextQuote = await requestCreatePreflight()
      if (quoteExpired || didCreateQuoteChange(quote, nextQuote)) {
        setQuote(nextQuote)
        setFeedback(buildRequotePrompt("create"))
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
      const [address] = await walletClient.getAddresses()

      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: contractAbi,
        functionName: "createDigitalTwin",
        args: [normalizedTwinId as `0x${string}`, metadataUrl.trim()],
        account: address,
        chain: bsc,
        value: BigInt(nextQuote.requiredValueWei),
      })

      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      setFeedback({
        tone: "success",
        title: "Twin created",
        body: `Creation confirmed in tx ${receipt.transactionHash.slice(0, 10)}... You can open the twin page now.`,
      })
    } catch (error) {
      sendClientTelemetry({
        name: "transaction_submission_failure",
        message: error instanceof Error ? error.message : "Create twin submission failed.",
        data: { flow: "create-twin", twinId: normalizedTwinId },
      })
      setFeedback(mapExecutionError("create", error))
    } finally {
      setSubmitting(false)
    }
  }

  const ownerLabel =
    !quote || !quote.isClaimed
      ? "Open"
      : quote.owner.toLowerCase() === zeroAddress
        ? "Open"
        : shortenAddress(quote.owner)
  const quoteExpired = isQuoteExpired(quote)
  const executionState = useMemo(
    () =>
      getWalletExecutionState({
        account,
        chainId,
        connecting,
      }),
    [account, chainId, connecting]
  )

  async function requestCreatePreflight() {
    const response = await fetch("/api/twins/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        twinId: normalizedTwinId,
        metadataUrl,
        ...(account ? { account } : {}),
      }),
    })
    const payload = (await response.json()) as CreateTwinPreflightPayload | ApiError
    if (!response.ok || !("quote" in payload)) {
      throw new Error("error" in payload && payload.error ? payload.error : "Creation preflight failed.")
    }
    return payload.quote
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.hero}>
        <span className={styles.eyebrow}>Twin Creation</span>
        <h1 className={styles.title}>Launch A Twin</h1>
        <p className={styles.subtitle}>
          This flow uses the onchain <code>createDigitalTwin</code> helper. It seeds the minimum
          required keys using the contract&apos;s live creation quote, then redirects you into the
          normal market flow once the transaction confirms.
        </p>
      </div>

      <div className={styles.layout}>
        <section className={styles.panel}>
          <div className={styles.fieldset}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="twin-id">
                Twin ID
              </label>
              <input
                id="twin-id"
                className={styles.input}
                value={twinIdInput}
                onChange={(event) => setTwinIdInput(event.target.value)}
                placeholder="0x1234abcd5678ef901234abcd5678ef90"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
              <div className={styles.hint}>
                Use a unique 16-byte ID. Format: <code>0x</code> plus 32 hex characters.
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="metadata-url">
                Metadata URL
              </label>
              <input
                id="metadata-url"
                className={styles.input}
                value={metadataUrl}
                onChange={(event) => setMetadataUrl(event.target.value)}
                placeholder="https://example.com/twin.json"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
              <div className={styles.hint}>
                This URL should resolve to the twin metadata the app already knows how to read.
              </div>
            </div>

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primary}
                onClick={() => void handleCreate()}
                disabled={submitting || connecting || isPending || !canCreate}
              >
                {submitting
                  ? "Launching..."
                  : account
                    ? "Create Twin"
                    : "Connect Wallet"}
              </button>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => {
                  setTwinIdInput("")
                  setMetadataUrl("")
                  setQuote(null)
                  setQuoteError(null)
                  setFeedback(null)
                }}
                disabled={submitting}
              >
                Reset
              </button>
            </div>

            <div
              className={`${styles.notice} ${
                executionState.tone === "ready" ? styles.success : styles.warning
              }`}
            >
              <strong>{executionState.headline}</strong>
            </div>

            {feedback ? (
              <div
                className={`${styles.notice} ${
                  feedback.tone === "success"
                    ? styles.success
                    : feedback.tone === "warning"
                      ? styles.warning
                      : styles.danger
                }`}
                role={feedback.tone === "error" ? "alert" : "status"}
              >
                <strong>{feedback.title}</strong>
                <p>
                  {feedback.body}{" "}
                  {feedback.tone === "success" && twinIdReady ? (
                    <Link className={styles.link} href={`/twin/${normalizedTwinId}`}>
                      Open twin page
                    </Link>
                  ) : null}
                </p>
              </div>
            ) : null}

            {quoteExpired && quote ? (
              <div className={`${styles.notice} ${styles.warning}`} role="status">
                <strong>Quote refresh required</strong>
                <p>
                  The displayed creation quote expired. The next submit will refresh the live seed
                  amount before signing.
                </p>
              </div>
            ) : null}

            {quoteError ? (
              <div className={`${styles.notice} ${styles.danger}`} role="alert">
                <strong>Quote unavailable</strong>
                <p>{quoteError}</p>
              </div>
            ) : null}

            {twinIdInput && !twinIdReady ? (
              <div className={`${styles.notice} ${styles.danger}`} role="alert">
                <strong>Invalid twin ID</strong>
                <p>Enter exactly 32 hexadecimal characters after the 0x prefix.</p>
              </div>
            ) : null}
          </div>
        </section>

        <aside className={styles.panel}>
          <div className={styles.summary}>
            <div>
              <div className={styles.label}>Creation Summary</div>
              <p className={styles.hint}>
                The quote below is read from the contract and reflects the required seed amount for
                the current <code>minSharesToCreate</code> value.
              </p>
            </div>

            <div className={styles.summaryGrid}>
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>Status</span>
                <span className={styles.summaryValue}>
                  {isPending
                    ? "Loading..."
                    : quote
                      ? quote.exists
                        ? "Already live"
                        : "Ready to create"
                      : "Waiting for valid twin ID"}
                </span>
              </div>
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>Claim owner</span>
                <span className={`${styles.summaryValue} ${styles.code}`}>{ownerLabel}</span>
              </div>
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>Seed keys</span>
                <span className={styles.summaryValue}>
                  {quote ? quote.minSharesToCreate : "--"}
                </span>
              </div>
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>Required USD (display only)</span>
                <span className={`${styles.summaryValue} ${styles.quoteValue}`}>
                  {quote ? formatUsd(Number(quote.requiredValueUsd)) : "--"}
                </span>
              </div>
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>Twin route</span>
                <span className={`${styles.summaryValue} ${styles.code}`}>
                  {twinIdReady ? `/twin/${normalizedTwinId}` : "--"}
                </span>
              </div>
            </div>

            {quote?.exists ? (
              <div className={`${styles.notice} ${styles.danger}`}>
                <strong>Already created</strong>
                <p>
                  This twin ID already exists onchain. Open{" "}
                  <Link className={styles.link} href={`/twin/${normalizedTwinId}`}>
                    its detail page
                  </Link>{" "}
                  instead of creating it again.
                </p>
              </div>
            ) : null}

            {quote?.isClaimed && account && quote.owner.toLowerCase() !== account.toLowerCase() ? (
              <div className={`${styles.notice} ${styles.danger}`}>
                <strong>Claimed by another wallet</strong>
                <p>
                  This twin ID is reserved for <span className={styles.code}>{quote.owner}</span>.
                  Switch to that wallet or choose a different twin ID.
                </p>
              </div>
            ) : null}

            <div className={styles.notice}>
              <strong>Launch rules</strong>
              <p>
                Creation is locked to BNB Smart Chain. The displayed seed quote is shown in USD, while
                the transaction still settles with the exact onchain BNB value required by the contract.
                </p>
              </div>
            <div className={styles.notice}>
              <strong>Testing link</strong>
              <p className={styles.code}>/create</p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
