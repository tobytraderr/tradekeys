"use client"

import { useDeferredValue, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { WalletButton } from "@/components/wallet-button"
import { UiIcon } from "@/components/ui-icon"
import type { TwinSummary } from "@/lib/types"
import styles from "./topbar.module.css"

type Props = {
  totalTwins: number
}

type SearchResponse = {
  results: TwinSummary[]
}

export function TopbarClient({ totalTwins }: Props) {
  const router = useRouter()
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<TwinSummary[]>([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const deferredQuery = useDeferredValue(query)

  useEffect(() => {
    if (!deferredQuery.trim()) {
      setResults([])
      setSearching(false)
      return
    }

    const controller = new AbortController()
    setSearching(true)

    const timeout = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/twins/search?q=${encodeURIComponent(deferredQuery.trim())}`,
          {
            signal: controller.signal,
            cache: "no-store",
          }
        )
        const payload = (await response.json()) as SearchResponse
        if (!controller.signal.aborted) {
          setResults(Array.isArray(payload.results) ? payload.results : [])
          setOpen(true)
        }
      } catch {
        if (!controller.signal.aborted) {
          setResults([])
        }
      } finally {
        if (!controller.signal.aborted) {
          setSearching(false)
        }
      }
    }, 180)

    return () => {
      controller.abort()
      clearTimeout(timeout)
    }
  }, [deferredQuery])

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setMobileSearchOpen(false)
      }
    }

    document.addEventListener("pointerdown", handlePointerDown)
    return () => document.removeEventListener("pointerdown", handlePointerDown)
  }, [])

  useEffect(() => {
    if (!mobileSearchOpen) return
    inputRef.current?.focus()
  }, [mobileSearchOpen])

  function goToTwin(id: string) {
    setOpen(false)
    setQuery("")
    setMobileSearchOpen(false)
    router.push(`/twin/${id}`)
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalized = query.trim()
    if (!normalized) return

    const exact =
      results.find((item) => item.id.toLowerCase() === normalized.toLowerCase()) ??
      results.find((item) => item.displayName.toLowerCase() === normalized.toLowerCase())

    if (exact) {
      goToTwin(exact.id)
      return
    }

    if (results[0]) {
      goToTwin(results[0].id)
      return
    }

    if (normalized.startsWith("0x")) {
      goToTwin(normalized)
    }
  }

  return (
    <header className={styles.topbar}>
      <div className={styles.left}>
        <div className={styles.totalPill}>
          <strong>{totalTwins.toLocaleString()}</strong>
          <span>Total Twins</span>
        </div>
      </div>

      <div
        className={`${styles.searchWrap} ${mobileSearchOpen ? styles.searchWrapExpanded : ""}`}
        ref={wrapperRef}
      >
        <button
          type="button"
          className={styles.searchToggle}
          aria-label="Open search"
          onClick={() => setMobileSearchOpen((current) => !current)}
        >
          <UiIcon name="search" className={styles.searchToggleIcon} />
        </button>
        <form className={styles.searchForm} onSubmit={handleSubmit}>
          <UiIcon name="search" className={styles.searchFieldIcon} />
          <input
            ref={inputRef}
            aria-label="Search twins"
            className={styles.searchInput}
            placeholder="Search twin ID or name"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => {
              setMobileSearchOpen(true)
              if (results.length > 0) setOpen(true)
            }}
          />
        </form>

        {open && (results.length > 0 || searching) ? (
          <div className={styles.searchPanel}>
            {searching ? <div className={styles.searchState}>Searching twins…</div> : null}
            {results.map((item) => (
              <button
                key={item.id}
                type="button"
                className={styles.searchResult}
                onClick={() => goToTwin(item.id)}
              >
                <div>
                  <strong>{item.displayName}</strong>
                  <div>{item.id}</div>
                </div>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className={styles.right}>
        <WalletButton />
      </div>
    </header>
  )
}
