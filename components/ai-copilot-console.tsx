"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { CopilotRichText } from "@/components/copilot-rich-text"
import { QuickBuyControl } from "@/components/quick-buy-control"
import { UiIcon } from "@/components/ui-icon"
import { useWallet } from "@/components/wallet-provider"
import { useWatchlist } from "@/components/watchlist-provider"
import { startActionFeedback, stopActionFeedback } from "@/lib/action-feedback"
import { consumePendingCopilotPrompt } from "@/lib/copilot-launch"
import { buildImageProxyUrl } from "@/lib/image-proxy"
import { useCopilotQuota } from "@/lib/use-copilot-quota"
import type {
  AiCopilotSnapshot,
  AiHealthSnapshot,
  CopilotQuotaSnapshot,
  CopilotMemory,
  CopilotPlan,
  CopilotPreparedAction,
  CopilotToolWarning,
  ResolvedTwinEntity,
  TwinSummary,
} from "@/lib/types"
import styles from "./ai-copilot-console.module.css"

type Props = {
  snapshot: AiCopilotSnapshot
}

type CopilotResponse = {
  prompt: string
  provider: string
  content: string
  modelName?: string
  settlementMode?: string
  transactionHash?: string | null
  paymentHash?: string | null
  teeId?: string | null
  teeEndpoint?: string | null
  teePaymentAddress?: string | null
  teeSignature?: string | null
  teeTimestamp?: number | null
  finishReason?: string | null
  error?: string
  aiHealth?: AiHealthSnapshot
  verifiedNewHolders1h?: number
  debug?: {
    planner?: CopilotPlan
    resolvedEntities?: ResolvedTwinEntity[]
    warnings?: CopilotToolWarning[]
    twinsProvided: number
    twinsUsed: number
    source: "client" | "system-tools"
  }
  usedTwins?: TwinSummary[]
  memory?: CopilotMemory
  availableActions?: CopilotPreparedAction[]
  quota?: CopilotQuotaSnapshot
}

type ThreadTurn = {
  id: string
  prompt: string
  status: "pending" | "completed" | "error"
  response?: CopilotResponse
  usedTwins: TwinSummary[]
  error?: string
}

const RECENT_QUERY_LIMIT = 6
const SIDE_RECENT_QUERY_LIMIT = 3
const SIDE_INSIGHT_LIMIT = 2

function buildDefaultPrompt(snapshot: AiCopilotSnapshot) {
  return (
    snapshot.suggestedPrompts[0] ??
    "Explain the latest holder growth and volume shifts across the most active twins."
  )
}

function getCoreStatus(aiHealth: AiHealthSnapshot) {
  if (aiHealth.status === "unavailable") {
    return { label: "OFFLINE", toneClass: styles.statusOffline }
  }

  return { label: "ONLINE", toneClass: styles.statusOnline }
}

function getScannerStatus(aiHealth: AiHealthSnapshot, feedError?: string) {
  if (aiHealth.status === "unavailable") {
    return { label: "OFFLINE", toneClass: styles.statusOffline }
  }

  if (feedError || aiHealth.status === "degraded") {
    return { label: "DELAYED", toneClass: styles.statusDelayed }
  }

  return { label: "ACTIVE", toneClass: styles.statusOnline }
}

function shortHash(value: string) {
  return `${value.slice(0, 10)}...${value.slice(-8)}`
}

function shortenId(value: string) {
  return value.length > 16 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value
}

function getProofValue(value?: string | null) {
  if (!value) return null
  return value.length > 42 ? shortHash(value) : value
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)
}

function readRecentQueries(key: string) {
  try {
    const raw = window.localStorage.getItem(key)
    const parsed = raw ? (JSON.parse(raw) as string[]) : []
    return Array.isArray(parsed) ? parsed.slice(0, RECENT_QUERY_LIMIT) : []
  } catch {
    return []
  }
}

function getActionIconName(kind: CopilotPreparedAction["kind"]) {
  if (kind === "buy") return "buy"
  if (kind === "sell") return "sell"
  return "star"
}

function getActionTitle(kind: CopilotPreparedAction["kind"]) {
  if (kind === "buy") return "Ready to buy"
  if (kind === "sell") return "Ready to sell"
  return "Watch this twin"
}

function getContextModeLabel(response?: CopilotResponse) {
  if (!response?.debug) return null

  const resolvedEntities = response.debug.resolvedEntities ?? []
  const planner = response.debug.planner

  if (resolvedEntities.some((entry) => entry.source === "memory")) {
    return "Mode: follow-up from active context"
  }

  if (response.debug.source === "client") {
    return "Mode: explicit twin context"
  }

  if (planner?.responseMode === "screening" && resolvedEntities.length === 0) {
    return "Mode: fresh market screen"
  }

  if (resolvedEntities.length > 0) {
    return "Mode: fresh entity resolution"
  }

  return "Mode: system market read"
}

function getQuotaStatusCopy(quota: CopilotQuotaSnapshot | null) {
  if (!quota?.enabled || quota.limit === null) {
    return null
  }

  if (quota.exhausted) {
    return `Daily AI Copilot limit reached for this user. ${quota.limit}/${quota.limit} prompts used.`
  }

  return `${quota.remaining ?? 0} of ${quota.limit} AI prompts remaining today.`
}

export function AiCopilotConsole({ snapshot }: Props) {
  const { account, connect } = useWallet()
  const { isWatched, toggle } = useWatchlist()
  const { quota, loading: quotaLoading, setQuota } = useCopilotQuota(account)
  const [prompt, setPrompt] = useState(buildDefaultPrompt(snapshot))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [thread, setThread] = useState<ThreadTurn[]>([])
  const [recentQueries, setRecentQueries] = useState<string[]>([])
  const [aiHealth, setAiHealth] = useState(snapshot.aiHealth)
  const [memory, setMemory] = useState<CopilotMemory>({ activeTwins: [] })
  const [pendingPromptHandled, setPendingPromptHandled] = useState(false)
  const openingLead = useMemo(() => snapshot.openingLead, [snapshot.openingLead])
  const coreStatus = useMemo(() => getCoreStatus(aiHealth), [aiHealth])
  const scannerStatus = useMemo(
    () => getScannerStatus(aiHealth, snapshot.feedError),
    [aiHealth, snapshot.feedError]
  )
  const quotaExhausted = Boolean(quota?.enabled && quota.exhausted)
  const composerDisabled = loading || quotaLoading || quotaExhausted
  const quotaStatusCopy = getQuotaStatusCopy(quota)

  const recentQueryKey = `tradekeys.ai-copilot.recent.${account ?? "guest"}`
  useEffect(() => {
    setRecentQueries(readRecentQueries(recentQueryKey))
  }, [recentQueryKey])

  useEffect(() => {
    if (pendingPromptHandled || quotaLoading) {
      return
    }

    setPendingPromptHandled(true)
    const pendingPrompt = consumePendingCopilotPrompt()
    if (!pendingPrompt) {
      return
    }

    setPrompt(pendingPrompt)
    if (quotaExhausted) {
      setError("Daily AI Copilot limit reached for this user. Try again tomorrow.")
      return
    }

    void runCopilot(pendingPrompt)
  }, [pendingPromptHandled, quotaExhausted, quotaLoading])

  const filteredSpotlights = useMemo(() => {
    return snapshot.spotlightTwins
  }, [snapshot.spotlightTwins])

  const filteredContextTwins = useMemo(() => {
    return snapshot.contextTwins
  }, [snapshot.contextTwins])

  function persistRecentQuery(nextPrompt: string) {
    const nextQueries = [nextPrompt, ...recentQueries.filter((item) => item !== nextPrompt)].slice(
      0,
      RECENT_QUERY_LIMIT
    )
    setRecentQueries(nextQueries)
    try {
      window.localStorage.setItem(recentQueryKey, JSON.stringify(nextQueries))
    } catch {
      // ignore storage access failure
    }
  }

  async function runCopilot(
    nextPrompt?: string,
    explicitTwins?: TwinSummary[]
  ) {
    if (quotaLoading) {
      setError("Checking your daily AI Copilot allowance. Try again in a moment.")
      return
    }

    if (quotaExhausted) {
      setError("Daily AI Copilot limit reached for this user. Try again tomorrow.")
      return
    }

    const finalPrompt = (nextPrompt ?? prompt).trim()
    if (!finalPrompt) {
      setError("Prompt is required.")
      return
    }

    const twinsForRun = explicitTwins && explicitTwins.length > 0 ? explicitTwins : []

    setPrompt(finalPrompt)
    setLoading(true)
    setError(null)
    const turnId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const history = thread
      .filter((turn) => turn.status === "completed" && turn.response?.content)
      .slice(-3)
      .map((turn) => ({
        prompt: turn.prompt,
        response: turn.response!.content,
      }))

    setThread((current) => [
      ...current,
      {
        id: turnId,
        prompt: finalPrompt,
        status: "pending",
        usedTwins: explicitTwins ?? [],
      },
    ])
    startActionFeedback({ label: "Running copilot", persistent: true })

    try {
      const response = await fetch("/api/ai/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: finalPrompt,
          account: account ?? undefined,
          twins: twinsForRun.length > 0 ? twinsForRun : undefined,
          debug: true,
          history,
          memory,
        }),
      })

      const payload = (await response.json()) as CopilotResponse
      if (payload.quota) {
        setQuota(payload.quota)
      }
      if (!response.ok) {
        throw new Error(payload.error || "Copilot request failed.")
      }

      const nextResult: CopilotResponse = {
        ...payload,
        usedTwins:
          payload.usedTwins ??
          (payload.debug?.twinsUsed === 0 ? [] : twinsForRun),
      }

      setThread((current) =>
        current.map((turn) =>
          turn.id === turnId
            ? {
                ...turn,
                status: "completed",
                response: nextResult,
              }
            : turn
        )
      )
      setAiHealth(payload.aiHealth ?? snapshot.aiHealth)
      setMemory(payload.memory ?? memory)
      persistRecentQuery(finalPrompt)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Copilot request failed."
      setThread((current) =>
        current.map((turn) =>
          turn.id === turnId
            ? {
                ...turn,
                status: "error",
                error: message,
              }
            : turn
        )
      )
      setAiHealth({
        status: "degraded",
        label: "AI degraded",
        detail: message,
      })
      setError(message)
    } finally {
      setLoading(false)
      stopActionFeedback()
    }
  }

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <section className={styles.hero}>
          <div>
            <h1 className={styles.heroTitle}>
              AI Copilot <span>/ Twin-Native Intelligence</span>
            </h1>
            <p className={styles.heroSummary}>
              System monitoring {snapshot.totalTwins.toLocaleString()} on-chain twins. Verified{" "}
              {snapshot.verifiedNewHolders1h.toLocaleString()} new holders across high-activity twins
              in the last hour. Specify a twin ID or name to begin analysis.
            </p>
          </div>
        </section>

        <section className={styles.responseArea}>
          <section className={styles.thread}>
            <div className={styles.threadTurn}>
              <article className={styles.assistantTurn}>
                <div className={`${styles.streamBadge} ${styles.streamBadgeAssistant}`}>
                  <UiIcon name="robot" className={styles.streamBadgeIcon} />
                </div>
                <div className={styles.streamBody}>
                  <div className={styles.assistantText}>{openingLead}</div>
                  <div className={styles.spotlightGrid}>
                    {(filteredSpotlights.length > 0 ? filteredSpotlights : snapshot.spotlightTwins).map((card) => (
                      <article key={card.twin.id} className={styles.spotlightCard}>
                        <div className={styles.spotlightHead}>
                          <div className={styles.spotlightIdentity}>
                            <div className={styles.cardAvatar}>
                              {card.twin.avatarUrl ? (
                                <img src={buildImageProxyUrl(card.twin.avatarUrl)} alt="" />
                              ) : (
                                <span>{card.twin.displayName.slice(0, 2).toUpperCase()}</span>
                              )}
                            </div>
                            <div>
                              <div className={styles.twinTag}>{shortenId(card.twin.id)}</div>
                              <h2>{card.twin.displayName}</h2>
                            </div>
                          </div>
                          <div
                            className={`${styles.velocityBadge} ${
                              card.holderGrowth1hPct >= 0 ? styles.velocityPositive : styles.velocityNegative
                            }`}
                          >
                            {card.priceVelocity}
                          </div>
                        </div>

                        <div className={styles.cardMetric}>
                          <strong>{formatCompactNumber(card.twin.holders)} Holders</strong>
                        </div>

                        <div className={styles.cardStats}>
                          <div>
                            <span>Holder growth (1H)</span>
                            <strong className={card.holderGrowth1hPct >= 0 ? styles.positive : styles.negative}>
                              {card.holderGrowth1hPct >= 0 ? "+" : ""}
                              {card.holderGrowth1hPct.toFixed(1)}%
                            </strong>
                          </div>
                          <div>
                            <span>Total supply</span>
                            <strong>{formatCompactNumber(card.twin.supply)}</strong>
                          </div>
                          <div>
                            <span>Indexed 1H change</span>
                            <strong className={card.twin.change1hPct >= 0 ? styles.positive : styles.negative}>
                              {card.twin.change1hPct >= 0 ? "+" : ""}
                              {card.twin.change1hPct.toFixed(1)}%
                            </strong>
                          </div>
                        </div>

                        <div className={styles.strengthBar}>
                          <span style={{ width: `${card.strengthPct}%` }} />
                        </div>

                        <div className={styles.evidenceChips}>
                          {card.evidence.map((chip) => (
                            <span key={chip}>{chip}</span>
                          ))}
                        </div>

                        <div className={styles.cardActions}>
                          <button
                            type="button"
                            className={styles.secondaryButton}
                            onClick={() =>
                              void runCopilot(`Give me a detailed summary for ${card.twin.displayName}.`, [card.twin])
                            }
                            disabled={composerDisabled}
                          >
                            Detailed summary
                          </button>
                          <div className={styles.inlineActions}>
                            <button
                              type="button"
                              className={styles.ghostButton}
                              onClick={() => {
                                if (!account) {
                                  void connect()
                                  return
                                }
                                void toggle(card.twin)
                              }}
                            >
                              {isWatched(card.twin.id) ? "Watching" : "Watchlist"}
                            </button>
                            <Link href={`/twin/${card.twin.id}`} className={styles.ghostButton}>
                              View twin
                            </Link>
                          </div>
                          <div className={styles.quickBuyDock}>
                            <QuickBuyControl
                              twinId={card.twin.id}
                              variant="card"
                              buttonLabel="Quick buy"
                              browseDataWarning={snapshot.feedError}
                            />
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              </article>
            </div>

            {thread.length > 0 ? (
              thread.map((turn) => {
                const turnEvidence =
                  turn.response?.usedTwins?.slice(0, 4) ?? turn.usedTwins.slice(0, 4)
                const availableActions = turn.response?.availableActions ?? []
                const contextModeLabel = getContextModeLabel(turn.response)
                const showTwinEvidence = turnEvidence.length > 0
                const showVerifiedHolders =
                  typeof turn.response?.verifiedNewHolders1h === "number"
                    ? turn.response.verifiedNewHolders1h > 0
                    : snapshot.verifiedNewHolders1h > 0

                return (
                  <div key={turn.id} className={styles.threadTurn}>
                    <article className={styles.userTurn}>
                      <div className={`${styles.streamBadge} ${styles.streamBadgeUser}`}>
                        <UiIcon name="user" className={styles.streamBadgeIcon} />
                      </div>
                      <div className={styles.userTurnContent}>
                        <div className={styles.userPromptHead}>
                          <span className={styles.userPromptLabel}>You asked</span>
                        </div>
                        <p>{turn.prompt}</p>
                      </div>
                    </article>

                    <section className={styles.assistantTurn}>
                      <div className={`${styles.streamBadge} ${styles.streamBadgeAssistant}`}>
                        <UiIcon name="robot" className={styles.streamBadgeIcon} />
                      </div>
                      <div className={styles.streamBody}>
                        <div className={styles.resultHeader}>
                          <div>
                            <span className={styles.resultLabel}>Copilot response</span>
                            <h3>
                              {turn.status === "pending"
                                ? "Running market pass"
                                : turn.status === "error"
                                  ? "Copilot request failed"
                                  : "Verifiable market readout"}
                            </h3>
                            {contextModeLabel ? (
                              <div className={styles.contextMode}>{contextModeLabel}</div>
                            ) : null}
                          </div>
                        </div>

                        {turn.status === "pending" ? (
                          <p className={styles.emptyResult}>
                            Copilot is analyzing recent flow, holder verification, and indexed market context.
                          </p>
                        ) : turn.status === "error" ? (
                          <p className={styles.errorText}>{turn.error}</p>
                        ) : turn.response ? (
                          <>
                            <div className={styles.resultBody}>
                              <CopilotRichText content={turn.response.content} />
                            </div>
                            {availableActions.length > 0 ? (
                              <div className={styles.actionGrid}>
                                {availableActions.map((action) => {
                                  const actionTwin = turn.response?.usedTwins?.find(
                                    (twin) => twin.id === action.twinId
                                  )

                                  return (
                                    <article key={`${turn.id}-${action.kind}-${action.twinId}`} className={styles.actionCard}>
                                      <div className={styles.actionCardHead}>
                                        <span className={styles.actionIconWrap}>
                                          <UiIcon
                                            name={getActionIconName(action.kind)}
                                            className={styles.actionIcon}
                                          />
                                        </span>
                                        <div className={styles.actionMeta}>
                                          <span>{getActionTitle(action.kind)}</span>
                                          <strong>{actionTwin?.displayName ?? action.label}</strong>
                                        </div>
                                      </div>

                                      <p className={styles.actionCopy}>
                                        {action.kind === "buy"
                                          ? "Jump into the live trade panel with the current market setup."
                                          : action.kind === "sell"
                                            ? "Review the live quote and exit conditions before submitting."
                                            : "Pin this twin to your watchlist for faster follow-up analysis."}
                                      </p>

                                      <div className={styles.actionCardFoot}>
                                        {action.kind === "buy" ? (
                                          <QuickBuyControl
                                            twinId={action.twinId}
                                            variant="card"
                                            buttonLabel={action.label}
                                            browseDataWarning={snapshot.feedError}
                                          />
                                        ) : action.kind === "watchlist" ? (
                                          <button
                                            type="button"
                                            className={styles.actionButton}
                                            onClick={() => {
                                              if (!actionTwin) {
                                                return
                                              }
                                              if (!account) {
                                                void connect()
                                                return
                                              }
                                              void toggle(actionTwin)
                                            }}
                                          >
                                            {actionTwin && isWatched(actionTwin.id) ? "Watching" : action.label}
                                          </button>
                                        ) : (
                                          <Link href={action.href} className={styles.actionButton}>
                                            {action.label}
                                          </Link>
                                        )}
                                      </div>
                                    </article>
                                  )
                                })}
                              </div>
                            ) : null}
                            <div className={styles.resultEvidence}>
                              {showTwinEvidence
                                ? turnEvidence.map((twin) => (
                                    <span key={twin.id}>{twin.displayName}</span>
                                  ))
                                : null}
                              <span>{turn.response.aiHealth?.label ?? aiHealth.label}</span>
                              {showVerifiedHolders ? (
                                <span>
                                  {typeof turn.response.verifiedNewHolders1h === "number"
                                    ? `${turn.response.verifiedNewHolders1h} verified holders (1H)`
                                    : `${snapshot.verifiedNewHolders1h} verified holders (1H)`}
                                </span>
                              ) : null}
                            </div>
                            <details className={styles.proofWrap}>
                              <summary className={styles.proofSummary}>Verifiable AI proof</summary>
                              <div className={styles.resultMeta}>
                                <div><span>Provider</span><strong>{turn.response.provider}</strong></div>
                                {turn.response.modelName ? (
                                  <div><span>Model</span><strong>{turn.response.modelName}</strong></div>
                                ) : null}
                                {turn.response.debug ? (
                                  <div>
                                    <span>Grounded context</span>
                                    <strong>{`${turn.response.debug.twinsUsed} twins (${turn.response.debug.source})`}</strong>
                                  </div>
                                ) : null}
                                {turn.response.teeId ? (
                                  <div>
                                    <span>TEE ID</span>
                                    <strong title={turn.response.teeId}>
                                      {getProofValue(turn.response.teeId)}
                                    </strong>
                                  </div>
                                ) : null}
                                {turn.response.teeSignature ? (
                                  <div>
                                    <span>TEE signature</span>
                                    <strong title={turn.response.teeSignature}>
                                      {getProofValue(turn.response.teeSignature)}
                                    </strong>
                                  </div>
                                ) : null}
                              </div>
                            </details>
                          </>
                        ) : null}
                      </div>
                    </section>
                  </div>
                )
              })
            ) : null}
          </section>
        </section>

        <section className={styles.composerWrap}>
          <div className={styles.promptSuggestions}>
            {snapshot.suggestedPrompts.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  className={styles.promptChip}
                  onClick={() => {
                    setPrompt(entry)
                    void runCopilot(entry)
                  }}
                  disabled={composerDisabled}
                >
                {entry}
              </button>
            ))}
          </div>

          <div className={styles.composer}>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Ask Copilot to compare twins, explain holder growth, scan for breakouts, or flag risk."
              disabled={composerDisabled}
            />
            <button
              type="button"
              className={styles.sendButton}
              aria-label={loading ? "Running copilot" : "Run copilot"}
              onClick={() => void runCopilot()}
              disabled={composerDisabled}
            >
              <span className={styles.sendIcon}>{loading ? "..." : "↑"}</span>
            </button>
          </div>
          {quotaStatusCopy ? (
            <p className={`${styles.quotaStatus} ${quotaExhausted ? styles.quotaError : styles.quotaWarning}`}>
              {quotaStatusCopy}
            </p>
          ) : null}
          <p className={styles.composerHint}>
            Professional twin terminal • evidence-based on-chain data
          </p>
        </section>
      </main>

      <aside className={styles.side}>
        <section className={styles.sideCard}>
          <span className={styles.sideLabel}>Intelligence Status</span>
          <div className={styles.statusRows}>
            <div className={styles.statusRow}>
              <span className={styles.statusName}>Copilot Core</span>
              <span className={`${styles.statusValue} ${coreStatus.toneClass}`}>
                <span className={styles.statusDot} />
                {coreStatus.label}
              </span>
            </div>
            <div className={styles.statusRow}>
              <span className={styles.statusName}>Market Scanners</span>
              <span className={`${styles.statusValue} ${scannerStatus.toneClass}`}>
                <span className={styles.statusDot} />
                {scannerStatus.label}
              </span>
            </div>
          </div>
        </section>

        <section className={styles.sideCard}>
          <span className={styles.sideLabel}>Recent queries</span>
          <div className={styles.recentQueries}>
            {recentQueries.length > 0 ? (
              recentQueries.slice(0, SIDE_RECENT_QUERY_LIMIT).map((entry) => (
                <button
                  key={entry}
                  type="button"
                  className={styles.recentQuery}
                  onClick={() => {
                    setPrompt(entry)
                    void runCopilot(entry)
                  }}
                  disabled={composerDisabled}
                >
                  {entry}
                </button>
              ))
            ) : (
              <p className={styles.sideEmpty}>Your last copilot prompts will show up here.</p>
            )}
          </div>
        </section>

        <section className={styles.sideCard}>
          <span className={styles.sideLabel}>Current insights</span>
          <div className={styles.sideInsights}>
            {snapshot.insights.slice(0, SIDE_INSIGHT_LIMIT).map((insight) => (
              <div key={insight.id} className={styles.sideInsight}>
                <span>{insight.label || insight.title}</span>
                <strong>{insight.subject || insight.title}</strong>
                <p>{insight.action || insight.body}</p>
              </div>
            ))}
          </div>
        </section>
      </aside>
    </div>
  )
}
