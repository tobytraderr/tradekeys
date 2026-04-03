"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import type { FeaturedTwin } from "@/lib/types"

type Props = {
  featured: FeaturedTwin
}

type OverrideResponse = {
  override?: {
    twinId: string
    label: string
    updatedAt: string
  } | null
  error?: string
}

export function FeaturedControlForm({ featured }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [twinId, setTwinId] = useState(featured.twin.id)
  const [label, setLabel] = useState(
    featured.source === "admin" ? featured.sourceLabel : "Admin Pick"
  )
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function publishOverride() {
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch("/api/admin/featured", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ twinId, label }),
      })
      const payload = (await response.json()) as OverrideResponse
      if (!response.ok) {
        throw new Error(payload.error || "Failed to publish featured override.")
      }
      setSuccess(`Featured override saved for ${payload.override?.twinId || twinId}.`)
      startTransition(() => {
        router.refresh()
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to publish featured override.")
    }
  }

  async function clearOverride() {
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch("/api/admin/featured", {
        method: "DELETE",
      })
      const payload = (await response.json()) as { ok?: boolean; error?: string }
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Failed to clear featured override.")
      }
      setSuccess("Featured override cleared. The homepage will fall back to env default or automatic selection.")
      startTransition(() => {
        router.refresh()
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to clear featured override.")
    }
  }

  return (
    <section className="panel" style={{ padding: 24 }}>
      <h1 className="section-title" style={{ fontSize: "3rem" }}>Featured Control</h1>
      <p className="section-subtitle">Set the homepage featured twin override</p>
      <div className="stack">
        <label className="stat-label" htmlFor="featured-twin-id">Target Twin ID</label>
        <input
          id="featured-twin-id"
          className="search"
          value={twinId}
          onChange={(event) => setTwinId(event.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        <label className="stat-label" htmlFor="featured-label">Source Label</label>
        <input
          id="featured-label"
          className="search"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          maxLength={80}
        />
        {error && <p className="danger">{error}</p>}
        {success && <p className="ticker">{success}</p>}
        <div className="featured-actions">
          <button className="btn-primary" type="button" onClick={() => void publishOverride()} disabled={isPending}>
            {isPending ? "Saving..." : "Publish New"}
          </button>
          <button className="btn-secondary" type="button" onClick={() => void clearOverride()} disabled={isPending}>
            Clear Override
          </button>
        </div>
      </div>
    </section>
  )
}
