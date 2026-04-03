"use client"

import { useEffect, useMemo, useState } from "react"
import { UiIcon } from "@/components/ui-icon"
import type { AdminOverview } from "@/lib/admin-types"
import type { CopilotPromptReviewStatus } from "@/lib/types"
import styles from "./admin-page-client.module.css"

type Props = {
  initialOverview: AdminOverview
}

type FeaturedResponse = {
  override?: {
    twinId: string
    label: string
    updatedAt: string
  } | null
  error?: string
}

type ReviewResponse = {
  review?: {
    id: number
    status: CopilotPromptReviewStatus
    reviewedAt?: string
  }
  error?: string
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Not available"
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return parsed.toLocaleString()
}

function formatBytes(value: number | null) {
  if (typeof value !== "number") {
    return "Not available"
  }
  if (value < 1024) {
    return `${value} B`
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function getAudienceClass(audience: "public" | "wallet" | "admin") {
  switch (audience) {
    case "admin":
      return styles.badgeDanger
    case "wallet":
      return styles.badgeInfo
    default:
      return styles.badgeNeutral
  }
}

function getEnvClass(configured: boolean) {
  return configured ? styles.badgeSuccess : styles.badgeDanger
}

function getReviewClass(status: CopilotPromptReviewStatus) {
  switch (status) {
    case "reviewed":
      return styles.badgeSuccess
    case "ignored":
      return styles.badgeNeutral
    default:
      return styles.badgeWarning
  }
}

function getHealthClass(status: "ok" | "degraded" | "down") {
  if (status === "ok") return styles.badgeSuccess
  if (status === "degraded") return styles.badgeWarning
  return styles.badgeDanger
}

function getAlertClass(severity: "warning" | "critical") {
  return severity === "critical" ? styles.badgeDanger : styles.badgeWarning
}

function getEventClass(level: "info" | "warn" | "error") {
  if (level === "error") return styles.badgeDanger
  if (level === "warn") return styles.badgeWarning
  return styles.badgeInfo
}

export function AdminPageClient({ initialOverview }: Props) {
  const [overview, setOverview] = useState(initialOverview)
  const [refreshing, setRefreshing] = useState(false)
  const [busyReviewId, setBusyReviewId] = useState<number | null>(null)
  const [savingFeatured, setSavingFeatured] = useState(false)
  const [clearingFeatured, setClearingFeatured] = useState(false)
  const [featuredTwinId, setFeaturedTwinId] = useState(initialOverview.featuredOverride?.twinId ?? "")
  const [featuredLabel, setFeaturedLabel] = useState(initialOverview.featuredOverride?.label ?? "Admin Pick")
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setFeaturedTwinId(overview.featuredOverride?.twinId ?? "")
    setFeaturedLabel(overview.featuredOverride?.label ?? "Admin Pick")
  }, [overview.featuredOverride])

  const openReviewCount = useMemo(
    () => overview.copilotReviews.filter((review) => review.status === "open").length,
    [overview.copilotReviews]
  )

  const configuredEnvCount = useMemo(
    () => overview.env.filter((entry) => entry.configured).length,
    [overview.env]
  )

  const activeAlertCount = useMemo(
    () => overview.opsAlerts.filter((alert) => alert.active).length,
    [overview.opsAlerts]
  )

  const healthDownCount = useMemo(
    () => overview.healthChecks.filter((check) => check.status === "down").length,
    [overview.healthChecks]
  )

  const traceStageCounts = useMemo(() => {
    return overview.copilotTraceTail.reduce<Record<string, number>>((accumulator, entry) => {
      accumulator[entry.stage] = (accumulator[entry.stage] ?? 0) + 1
      return accumulator
    }, {})
  }, [overview.copilotTraceTail])

  async function refreshOverview(options?: { quiet?: boolean }) {
    if (!options?.quiet) {
      setRefreshing(true)
      setError(null)
      setFeedback(null)
    }

    try {
      const response = await fetch("/api/admin/overview", { cache: "no-store" })
      const payload = (await response.json()) as AdminOverview | { error?: string }
      if (!response.ok) {
        throw new Error(
          "error" in payload ? payload.error || "Failed to refresh admin data." : "Failed to refresh admin data."
        )
      }

      setOverview(payload as AdminOverview)
      if (!options?.quiet) {
        setFeedback("Admin snapshot refreshed.")
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to refresh admin data.")
    } finally {
      setRefreshing(false)
    }
  }

  async function saveFeaturedOverride() {
    setSavingFeatured(true)
    setError(null)
    setFeedback(null)

    try {
      const response = await fetch("/api/admin/featured", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          twinId: featuredTwinId.trim(),
          label: featuredLabel.trim() || "Admin Pick",
        }),
      })
      const payload = (await response.json()) as FeaturedResponse
      if (!response.ok) {
        throw new Error(payload.error || "Failed to save featured override.")
      }

      setFeedback(`Featured override saved for ${payload.override?.twinId ?? featuredTwinId.trim()}.`)
      await refreshOverview({ quiet: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to save featured override.")
    } finally {
      setSavingFeatured(false)
    }
  }

  async function clearFeaturedOverride() {
    setClearingFeatured(true)
    setError(null)
    setFeedback(null)

    try {
      const response = await fetch("/api/admin/featured", { method: "DELETE" })
      const payload = (await response.json()) as { ok?: boolean; error?: string }
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Failed to clear featured override.")
      }

      setFeedback("Featured override cleared.")
      await refreshOverview({ quiet: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to clear featured override.")
    } finally {
      setClearingFeatured(false)
    }
  }

  async function updateReviewStatus(id: number, status: CopilotPromptReviewStatus) {
    setBusyReviewId(id)
    setError(null)
    setFeedback(null)

    try {
      const response = await fetch(`/api/admin/copilot-reviews/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      const payload = (await response.json()) as ReviewResponse
      if (!response.ok) {
        throw new Error(payload.error || "Failed to update review status.")
      }

      setOverview((current) => ({
        ...current,
        copilotReviews: current.copilotReviews.map((review) =>
          review.id === id
            ? {
                ...review,
                status,
                ...(payload.review?.reviewedAt ? { reviewedAt: payload.review.reviewedAt } : {}),
              }
            : review
        ),
      }))
      setFeedback(`Review #${id} marked ${status}.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to update review status.")
    } finally {
      setBusyReviewId(null)
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <div className={styles.kicker}>Protected Admin Route</div>
          <h1 className={styles.title}>TradeKeys Admin Console</h1>
          <p className={styles.subtitle}>
            Protected by env-derived basic auth and built to expose the live route catalog,
            payload shapes, operational tables, file-backed artifacts, and copilot logs from one screen.
          </p>
        </div>
        <div className={styles.heroActions}>
          <div className={styles.authCard}>
            <div className={styles.authLabel}>Auth</div>
            <strong>{overview.auth.usernameHint ?? "Missing admin credentials"}</strong>
            <span>{overview.auth.protectedPrefixes.join(" + ")}</span>
          </div>
          <button type="button" className={styles.primaryButton} onClick={() => void refreshOverview()} disabled={refreshing}>
            {refreshing ? "Refreshing..." : "Refresh Snapshot"}
          </button>
        </div>
      </header>

      {error ? <p className={styles.error}>{error}</p> : null}
      {feedback ? <p className={styles.success}>{feedback}</p> : null}

      <section className={styles.metricGrid}>
        <article className={styles.metricCard}>
          <span className={styles.metricLabel}>Documented Routes</span>
          <strong>{overview.endpoints.length}</strong>
          <small>Public, wallet-scoped, and admin endpoints</small>
        </article>
        <article className={styles.metricCard}>
          <span className={styles.metricLabel}>Open Review Items</span>
          <strong>{openReviewCount}</strong>
          <small>Copilot clarifications or orchestration errors awaiting triage</small>
        </article>
        <article className={styles.metricCard}>
          <span className={styles.metricLabel}>Configured Env Vars</span>
          <strong>{configuredEnvCount}</strong>
          <small>Out of {overview.env.length} tracked runtime inputs</small>
        </article>
        <article className={styles.metricCard}>
          <span className={styles.metricLabel}>Active Ops Alerts</span>
          <strong>{activeAlertCount}</strong>
          <small>{healthDownCount} dependency checks currently down</small>
        </article>
      </section>

      <section className={styles.controlGrid}>
        <article className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <h2>Featured Override</h2>
              <p>Manage the homepage hero pick without touching files directly.</p>
            </div>
            <UiIcon name="star" className={styles.panelIcon} />
          </div>
          <label className={styles.fieldLabel} htmlFor="admin-featured-id">
            Twin ID
          </label>
          <input
            id="admin-featured-id"
            className={styles.input}
            value={featuredTwinId}
            onChange={(event) => setFeaturedTwinId(event.target.value)}
            placeholder="0x85f4f72079114bfcac1003134e5424f4"
            spellCheck={false}
          />
          <label className={styles.fieldLabel} htmlFor="admin-featured-label">
            Display Label
          </label>
          <input
            id="admin-featured-label"
            className={styles.input}
            value={featuredLabel}
            onChange={(event) => setFeaturedLabel(event.target.value)}
            placeholder="Admin Pick"
          />
          <div className={styles.inlineMeta}>
            <span className={`${styles.badge} ${overview.featuredOverride ? styles.badgeSuccess : styles.badgeNeutral}`}>
              {overview.featuredOverride ? "Override active" : "No override"}
            </span>
            <span>Last updated: {formatDateTime(overview.featuredOverride?.updatedAt)}</span>
          </div>
          <div className={styles.actionRow}>
            <button type="button" className={styles.primaryButton} onClick={() => void saveFeaturedOverride()} disabled={savingFeatured}>
              {savingFeatured ? "Saving..." : "Save Override"}
            </button>
            <button type="button" className={styles.secondaryButton} onClick={() => void clearFeaturedOverride()} disabled={clearingFeatured}>
              {clearingFeatured ? "Clearing..." : "Clear Override"}
            </button>
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <h2>Copilot Review Queue</h2>
              <p>Mark clarification and orchestration issues open, reviewed, or ignored.</p>
            </div>
            <UiIcon name="brain" className={styles.panelIcon} />
          </div>
          <div className={styles.reviewList}>
            {overview.copilotReviews.length === 0 ? (
              <div className={styles.emptyState}>No review items captured yet.</div>
            ) : (
              overview.copilotReviews.map((review) => (
                <article key={review.id} className={styles.reviewCard}>
                  <div className={styles.reviewHead}>
                    <div>
                      <strong>#{review.id}</strong>
                      <p>{review.reason.replaceAll("_", " ")}</p>
                    </div>
                    <span className={`${styles.badge} ${getReviewClass(review.status)}`}>{review.status}</span>
                  </div>
                  <p className={styles.reviewPrompt}>{review.prompt}</p>
                  <div className={styles.inlineMeta}>
                    <span>Created: {formatDateTime(review.createdAt)}</span>
                    <span>Intent: {review.intent ?? "unknown"}</span>
                    <span>Confidence: {typeof review.confidence === "number" ? review.confidence.toFixed(2) : "n/a"}</span>
                  </div>
                  {review.errorMessage ? <p className={styles.errorInline}>{review.errorMessage}</p> : null}
                  <div className={styles.actionRowCompact}>
                    {(["open", "reviewed", "ignored"] as const).map((status) => (
                      <button
                        key={`${review.id}-${status}`}
                        type="button"
                        className={status === review.status ? styles.secondaryButton : styles.ghostButton}
                        onClick={() => void updateReviewStatus(review.id, status)}
                        disabled={busyReviewId === review.id}
                      >
                        {busyReviewId === review.id && status !== review.status ? "Updating..." : status}
                      </button>
                    ))}
                  </div>
                </article>
              ))
            )}
          </div>
        </article>
      </section>

      <section className={styles.workspace}>
        <div className={styles.mainColumn}>
          <article className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <h2>Operational Health</h2>
                <p>Dependency readiness, active alerts, env validation, and safe defaults.</p>
              </div>
              <UiIcon name="shield" className={styles.panelIcon} />
            </div>
            <div className={styles.stack}>
              <div className={styles.infoCard}>
                <div className={styles.infoHead}>
                  <strong>Dependency checks</strong>
                  <span className={`${styles.badge} ${healthDownCount === 0 ? styles.badgeSuccess : styles.badgeDanger}`}>
                    {healthDownCount === 0 ? "healthy" : "attention"}
                  </span>
                </div>
                <div className={styles.stackCompact}>
                  {overview.healthChecks.map((check) => (
                    <div key={check.target} className={styles.infoCardInner}>
                      <div className={styles.infoHead}>
                        <strong>{check.target}</strong>
                        <span className={`${styles.badge} ${getHealthClass(check.status)}`}>{check.status}</span>
                      </div>
                      <p>{check.detail}</p>
                      <div className={styles.inlineMeta}>
                        <span>Latency: {typeof check.latencyMs === "number" ? `${check.latencyMs} ms` : "n/a"}</span>
                        <span>Checked: {formatDateTime(check.checkedAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className={styles.infoCard}>
                <div className={styles.infoHead}>
                  <strong>Active alerts</strong>
                  <span className={`${styles.badge} ${activeAlertCount > 0 ? styles.badgeDanger : styles.badgeSuccess}`}>
                    {activeAlertCount > 0 ? `${activeAlertCount} active` : "quiet"}
                  </span>
                </div>
                <div className={styles.stackCompact}>
                  {overview.opsAlerts.map((alert) => (
                    <div key={alert.id} className={styles.infoCardInner}>
                      <div className={styles.infoHead}>
                        <strong>{alert.id.replaceAll("_", " ")}</strong>
                        <span className={`${styles.badge} ${alert.active ? getAlertClass(alert.severity) : styles.badgeNeutral}`}>
                          {alert.active ? alert.severity : "inactive"}
                        </span>
                      </div>
                      <p>{alert.message}</p>
                      <div className={styles.inlineMeta}>
                        <span>Count: {alert.count}</span>
                        <span>Threshold: {alert.threshold}</span>
                        <span>Window: {alert.windowMinutes} min</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className={styles.infoCard}>
                <div className={styles.infoHead}>
                  <strong>Environment validation</strong>
                  <span className={`${styles.badge} ${overview.envValidation.healthy ? styles.badgeSuccess : styles.badgeDanger}`}>
                    {overview.envValidation.environment}
                  </span>
                </div>
                <div className={styles.stackCompact}>
                  <div className={styles.infoCardInner}>
                    <strong>Missing critical</strong>
                    {overview.envValidation.missingCritical.length === 0 ? (
                      <p>None.</p>
                    ) : (
                      <ul className={styles.inlineList}>
                        {overview.envValidation.missingCritical.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className={styles.infoCardInner}>
                    <strong>Warnings</strong>
                    {overview.envValidation.warnings.length === 0 ? (
                      <p>None.</p>
                    ) : (
                      <ul className={styles.inlineList}>
                        {overview.envValidation.warnings.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className={styles.infoCardInner}>
                    <strong>Defaults in use</strong>
                    {overview.envValidation.defaultsInUse.length === 0 ? (
                      <p>None.</p>
                    ) : (
                      <ul className={styles.inlineList}>
                        {overview.envValidation.defaultsInUse.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </article>

          <article className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <h2>Operational Metrics</h2>
                <p>Refresh success, cache behavior, quote latency, API errors, and wallet-execution failures.</p>
              </div>
              <UiIcon name="spark" className={styles.panelIcon} />
            </div>
            <div className={styles.stack}>
              {overview.opsMetrics.length === 0 ? (
                <div className={styles.emptyState}>No operational metrics recorded yet.</div>
              ) : (
                overview.opsMetrics.map((metric) => (
                  <div key={metric.key} className={styles.infoCard}>
                    <div className={styles.infoHead}>
                      <strong>{metric.name}</strong>
                      <span className={`${styles.badge} ${metric.failureCount > 0 ? styles.badgeWarning : styles.badgeSuccess}`}>
                        {metric.count} samples
                      </span>
                    </div>
                    <div className={styles.inlineMeta}>
                      <span>Success rate: {metric.successRatePct !== null ? `${metric.successRatePct}%` : "n/a"}</span>
                      <span>Avg latency: {metric.avgDurationMs !== null ? `${metric.avgDurationMs} ms` : "n/a"}</span>
                      <span>Last latency: {metric.lastDurationMs !== null ? `${metric.lastDurationMs} ms` : "n/a"}</span>
                    </div>
                    {Object.keys(metric.labels).length > 0 ? (
                      <pre className={styles.codeBlock}>{formatJson(metric.labels)}</pre>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </article>

          <article className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <h2>Endpoint Catalog</h2>
                <p>Every route currently surfaced in the app, plus payload examples and backing stores.</p>
              </div>
              <UiIcon name="code" className={styles.panelIcon} />
            </div>
            <div className={styles.endpointList}>
              {overview.endpoints.map((endpoint) => (
                <details key={endpoint.path} className={styles.endpointCard}>
                  <summary className={styles.endpointSummary}>
                    <div>
                      <div className={styles.endpointTitleRow}>
                        <code>{endpoint.path}</code>
                        <span className={`${styles.badge} ${getAudienceClass(endpoint.audience)}`}>{endpoint.audience}</span>
                      </div>
                      <p>{endpoint.summary}</p>
                    </div>
                    <div className={styles.methodRow}>
                      {endpoint.methods.map((method) => (
                        <span key={`${endpoint.path}-${method}`} className={`${styles.badge} ${styles.badgeInfo}`}>
                          {method}
                        </span>
                      ))}
                    </div>
                  </summary>
                  <div className={styles.endpointBody}>
                    {endpoint.query?.length ? (
                      <div className={styles.detailBlock}>
                        <h3>Query</h3>
                        <ul className={styles.inlineList}>
                          {endpoint.query.map((item) => (
                            <li key={`${endpoint.path}-${item.name}`}>
                              <code>{item.name}</code> {item.required ? "(required)" : "(optional)"}: {item.description}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {endpoint.requestBody ? (
                      <div className={styles.detailBlock}>
                        <h3>Request Body</h3>
                        <p>{endpoint.requestBody.description}</p>
                        <pre className={styles.codeBlock}>{formatJson(endpoint.requestBody.example)}</pre>
                      </div>
                    ) : null}
                    <div className={styles.detailBlock}>
                      <h3>Response</h3>
                      <p>{endpoint.response.description}</p>
                      <pre className={styles.codeBlock}>{formatJson(endpoint.response.example)}</pre>
                    </div>
                    <div className={styles.detailBlock}>
                      <h3>Backed By</h3>
                      <ul className={styles.inlineList}>
                        {endpoint.dataSources.map((source) => (
                          <li key={`${endpoint.path}-${source}`}>{source}</li>
                        ))}
                      </ul>
                    </div>
                    <div className={styles.detailBlock}>
                      <h3>UI Surface</h3>
                      <ul className={styles.inlineList}>
                        {endpoint.uiCapabilities.map((capability) => (
                          <li key={`${endpoint.path}-${capability}`}>{capability}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          </article>

          <article className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <h2>Copilot Trace Tail</h2>
                <p>Structured NDJSON tail from the copilot route, newest first.</p>
              </div>
              <UiIcon name="history" className={styles.panelIcon} />
            </div>
            <div className={styles.stageRow}>
              {Object.entries(traceStageCounts).map(([stage, count]) => (
                <span key={stage} className={`${styles.badge} ${styles.badgeNeutral}`}>
                  {stage} x{count}
                </span>
              ))}
              {Object.keys(traceStageCounts).length === 0 ? (
                <span className={`${styles.badge} ${styles.badgeNeutral}`}>No trace entries yet</span>
              ) : null}
            </div>
            <div className={styles.traceList}>
              {overview.copilotTraceTail.map((entry) => (
                <details key={`${entry.traceId}-${entry.timestamp}-${entry.stage}`} className={styles.traceCard}>
                  <summary className={styles.traceSummary}>
                    <div>
                      <strong>{entry.stage}</strong>
                      <p>{entry.traceId}</p>
                    </div>
                    <span>{formatDateTime(entry.timestamp)}</span>
                  </summary>
                  {entry.payload !== undefined ? (
                    <pre className={styles.codeBlock}>{formatJson(entry.payload)}</pre>
                  ) : (
                    <div className={styles.emptyState}>No payload for this trace stage.</div>
                  )}
                </details>
              ))}
            </div>
          </article>

          <article className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <h2>Ops Event Tail</h2>
                <p>Recent upstream failures, cache transitions, alerts, quote-path issues, and client telemetry.</p>
              </div>
              <UiIcon name="history" className={styles.panelIcon} />
            </div>
            <div className={styles.traceList}>
              {overview.opsEventTail.length === 0 ? (
                <div className={styles.emptyState}>No ops events recorded yet.</div>
              ) : (
                overview.opsEventTail.map((entry) => (
                  <details key={`${entry.timestamp}-${entry.name}`} className={styles.traceCard}>
                    <summary className={styles.traceSummary}>
                      <div>
                        <strong>{entry.name}</strong>
                        <p>{entry.message}</p>
                      </div>
                      <div className={styles.inlineMeta}>
                        <span className={`${styles.badge} ${getEventClass(entry.level)}`}>{entry.level}</span>
                        <span>{formatDateTime(entry.timestamp)}</span>
                      </div>
                    </summary>
                    <div className={styles.detailBlock}>
                      <div className={styles.inlineMeta}>
                        <span>Category: {entry.category}</span>
                        <span>Dependency: {entry.dependency ?? "n/a"}</span>
                        <span>Latency: {typeof entry.durationMs === "number" ? `${entry.durationMs} ms` : "n/a"}</span>
                        <span>Status: {typeof entry.statusCode === "number" ? entry.statusCode : "n/a"}</span>
                      </div>
                      {entry.data !== undefined ? <pre className={styles.codeBlock}>{formatJson(entry.data)}</pre> : null}
                    </div>
                  </details>
                ))
              )}
            </div>
          </article>
        </div>

        <aside className={styles.sideColumn}>
          <article className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <h2>Rate Limits</h2>
                <p>429 activity by upstream dependency across the active alert window.</p>
              </div>
              <UiIcon name="list" className={styles.panelIcon} />
            </div>
            <div className={styles.stack}>
              {overview.rateLimits.length === 0 ? (
                <div className={styles.emptyState}>No recent upstream 429s detected.</div>
              ) : (
                overview.rateLimits.map((entry) => (
                  <div key={entry.dependency} className={styles.infoCard}>
                    <div className={styles.infoHead}>
                      <strong>{entry.dependency}</strong>
                      <span className={`${styles.badge} ${styles.badgeWarning}`}>{entry.count} hits</span>
                    </div>
                    <p>Last rate-limit event: {formatDateTime(entry.lastAt)}</p>
                  </div>
                ))
              )}
            </div>
          </article>

          <article className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <h2>Environment</h2>
                <p>Safe previews only. Secrets stay masked.</p>
              </div>
              <UiIcon name="shield" className={styles.panelIcon} />
            </div>
            <div className={styles.stack}>
              {overview.env.map((entry) => (
                <div key={entry.name} className={styles.infoCard}>
                  <div className={styles.infoHead}>
                    <code>{entry.name}</code>
                    <span className={`${styles.badge} ${getEnvClass(entry.configured)}`}>{entry.source}</span>
                  </div>
                  <p>{entry.description}</p>
                  <strong>{entry.safeValue ?? "Not configured"}</strong>
                </div>
              ))}
            </div>
          </article>

          <article className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <h2>Database Tables</h2>
                <p>Presence, row counts, and last activity for backed tables.</p>
              </div>
              <UiIcon name="list" className={styles.panelIcon} />
            </div>
            <div className={styles.stack}>
              {overview.database.tables.map((table) => (
                <div key={table.name} className={styles.infoCard}>
                  <div className={styles.infoHead}>
                    <strong>{table.label}</strong>
                    <span className={`${styles.badge} ${table.exists ? styles.badgeSuccess : styles.badgeNeutral}`}>
                      {table.exists ? "present" : "missing"}
                    </span>
                  </div>
                  <p>{table.description}</p>
                  <div className={styles.inlineMeta}>
                    <span>Rows: {table.rowCount ?? "n/a"}</span>
                    <span>Last update: {formatDateTime(table.lastUpdatedAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <h2>Artifacts</h2>
                <p>Filesystem-backed caches, logs, and override files visible to the UI.</p>
              </div>
              <UiIcon name="settings" className={styles.panelIcon} />
            </div>
            <div className={styles.stack}>
              {overview.artifacts.map((artifact) => (
                <details key={artifact.path} className={styles.infoCard}>
                  <summary className={styles.infoSummary}>
                    <div>
                      <strong>{artifact.label}</strong>
                      <p>{artifact.description}</p>
                    </div>
                    <span className={`${styles.badge} ${artifact.exists ? styles.badgeSuccess : styles.badgeNeutral}`}>
                      {artifact.exists ? "present" : "missing"}
                    </span>
                  </summary>
                  <div className={styles.detailBlock}>
                    <div className={styles.inlineMeta}>
                      <span>{formatBytes(artifact.sizeBytes)}</span>
                      <span>{formatDateTime(artifact.modifiedAt)}</span>
                    </div>
                    <code className={styles.pathLabel}>{artifact.path}</code>
                    {artifact.preview !== undefined ? <pre className={styles.codeBlock}>{formatJson(artifact.preview)}</pre> : null}
                  </div>
                </details>
              ))}
            </div>
          </article>

          <article className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <h2>Recent Sync Runs</h2>
                <p>Last ten catalog run records already available from the database.</p>
              </div>
              <UiIcon name="spark" className={styles.panelIcon} />
            </div>
            <div className={styles.stack}>
              {overview.database.recentSyncRuns.length === 0 ? (
                <div className={styles.emptyState}>No sync runs recorded yet.</div>
              ) : (
                overview.database.recentSyncRuns.map((run) => (
                  <details key={run.id} className={styles.infoCard}>
                    <summary className={styles.infoSummary}>
                      <div>
                        <strong>#{run.id} {run.source}</strong>
                        <p>{run.mode}</p>
                      </div>
                      <span className={`${styles.badge} ${run.status === "success" ? styles.badgeSuccess : run.status === "failed" ? styles.badgeDanger : styles.badgeWarning}`}>
                        {run.status}
                      </span>
                    </summary>
                    <div className={styles.inlineMeta}>
                      <span>Started: {formatDateTime(run.startedAt)}</span>
                      <span>Completed: {formatDateTime(run.completedAt)}</span>
                    </div>
                    {run.details !== undefined ? <pre className={styles.codeBlock}>{formatJson(run.details)}</pre> : null}
                  </details>
                ))
              )}
            </div>
          </article>

          <article className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <h2>Next Admin Endpoints</h2>
                <p>Straightforward additions that would deepen control beyond the current UI.</p>
              </div>
              <UiIcon name="plus" className={styles.panelIcon} />
            </div>
            <div className={styles.stack}>
              {overview.plannedEndpoints.map((endpoint) => (
                <details key={endpoint.path} className={styles.infoCard}>
                  <summary className={styles.infoSummary}>
                    <div>
                      <code>{endpoint.path}</code>
                      <p>{endpoint.summary}</p>
                    </div>
                    <span className={`${styles.badge} ${styles.badgeInfo}`}>{endpoint.methods.join(", ")}</span>
                  </summary>
                  <p>{endpoint.purpose}</p>
                  {endpoint.requestExample !== undefined ? <pre className={styles.codeBlock}>{formatJson(endpoint.requestExample)}</pre> : null}
                  {endpoint.responseExample !== undefined ? <pre className={styles.codeBlock}>{formatJson(endpoint.responseExample)}</pre> : null}
                </details>
              ))}
            </div>
          </article>

          <article className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <h2>Incident Playbooks</h2>
                <p>Fast operator guidance for the core failure modes already instrumented here.</p>
              </div>
              <UiIcon name="settings" className={styles.panelIcon} />
            </div>
            <div className={styles.stack}>
              {overview.playbooks.map((playbook) => (
                <details key={playbook.id} className={styles.infoCard}>
                  <summary className={styles.infoSummary}>
                    <div>
                      <strong>{playbook.title}</strong>
                      <p>{playbook.summary}</p>
                    </div>
                    <span className={`${styles.badge} ${styles.badgeInfo}`}>playbook</span>
                  </summary>
                  <ul className={styles.inlineList}>
                    {playbook.steps.map((step) => (
                      <li key={`${playbook.id}-${step}`}>{step}</li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          </article>
        </aside>
      </section>
    </div>
  )
}
