"use client"

import { usePathname } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { ACTION_FEEDBACK_EVENTS } from "@/lib/action-feedback"
import styles from "./global-action-feedback.module.css"

type FeedbackState = {
  visible: boolean
  label: string
  persistent: boolean
  tone: "info" | "success" | "error"
  mode: "loading" | "notice"
}

const DEFAULT_LABEL = "Working"

function isInternalNavigationTarget(target: HTMLElement) {
  const anchor = target.closest("a[href]") as HTMLAnchorElement | null
  if (!anchor) {
    return false
  }

  if (anchor.target === "_blank" || anchor.hasAttribute("download")) {
    return false
  }

  const href = anchor.getAttribute("href")
  return Boolean(href && href.startsWith("/"))
}

function isActionableTarget(target: HTMLElement) {
  if (target.closest("[aria-disabled='true']")) {
    return false
  }

  const button = target.closest("button") as HTMLButtonElement | null
  if (button) {
    return !button.disabled
  }

  const anchor = target.closest("a[href]") as HTMLAnchorElement | null
  if (anchor) {
    return true
  }

  return false
}

export function GlobalActionFeedback() {
  const pathname = usePathname()
  const [feedback, setFeedback] = useState<FeedbackState>({
    visible: false,
    label: DEFAULT_LABEL,
    persistent: false,
    tone: "info",
    mode: "loading",
  })
  const hideTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        window.clearTimeout(hideTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!feedback.persistent) {
      return
    }

    setFeedback((current) => ({
      ...current,
      visible: false,
      persistent: false,
      label: DEFAULT_LABEL,
      tone: "info",
      mode: "loading",
    }))
  }, [pathname])

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement) || !isActionableTarget(target)) {
        return
      }

      const persistent = isInternalNavigationTarget(target)
      setFeedback({
        visible: true,
        label: persistent ? "Opening" : DEFAULT_LABEL,
        persistent,
        tone: "info",
        mode: "loading",
      })

      if (hideTimeoutRef.current) {
        window.clearTimeout(hideTimeoutRef.current)
      }

      if (!persistent) {
        hideTimeoutRef.current = window.setTimeout(() => {
          setFeedback({
            visible: false,
            label: DEFAULT_LABEL,
            persistent: false,
            tone: "info",
            mode: "loading",
          })
        }, 700)
      }
    }

    const handleStart = (event: Event) => {
      const customEvent = event as CustomEvent<{ label?: string; persistent?: boolean }>
      const label = customEvent.detail?.label?.trim() || DEFAULT_LABEL
      const persistent = Boolean(customEvent.detail?.persistent)
      setFeedback({
        visible: true,
        label,
        persistent,
        tone: "info",
        mode: "loading",
      })

      if (hideTimeoutRef.current) {
        window.clearTimeout(hideTimeoutRef.current)
      }

      if (!persistent) {
        hideTimeoutRef.current = window.setTimeout(() => {
          setFeedback({
            visible: false,
            label: DEFAULT_LABEL,
            persistent: false,
            tone: "info",
            mode: "loading",
          })
        }, 900)
      }
    }

    const handleNotice = (event: Event) => {
      const customEvent = event as CustomEvent<{
        label?: string
        tone?: "info" | "success" | "error"
        durationMs?: number
      }>
      const label = customEvent.detail?.label?.trim() || DEFAULT_LABEL
      const tone = customEvent.detail?.tone ?? "info"
      const durationMs = customEvent.detail?.durationMs ?? 2200

      setFeedback({
        visible: true,
        label,
        persistent: false,
        tone,
        mode: "notice",
      })

      if (hideTimeoutRef.current) {
        window.clearTimeout(hideTimeoutRef.current)
      }

      hideTimeoutRef.current = window.setTimeout(() => {
        setFeedback({
          visible: false,
          label: DEFAULT_LABEL,
          persistent: false,
          tone: "info",
          mode: "loading",
        })
      }, durationMs)
    }

    const handleStop = () => {
      setFeedback({
        visible: false,
        label: DEFAULT_LABEL,
        persistent: false,
        tone: "info",
        mode: "loading",
      })

      if (hideTimeoutRef.current) {
        window.clearTimeout(hideTimeoutRef.current)
      }
    }

    document.addEventListener("click", handleClick, true)
    window.addEventListener(ACTION_FEEDBACK_EVENTS.START_EVENT, handleStart as EventListener)
    window.addEventListener(ACTION_FEEDBACK_EVENTS.NOTICE_EVENT, handleNotice as EventListener)
    window.addEventListener(ACTION_FEEDBACK_EVENTS.STOP_EVENT, handleStop)

    return () => {
      document.removeEventListener("click", handleClick, true)
      window.removeEventListener(ACTION_FEEDBACK_EVENTS.START_EVENT, handleStart as EventListener)
      window.removeEventListener(ACTION_FEEDBACK_EVENTS.NOTICE_EVENT, handleNotice as EventListener)
      window.removeEventListener(ACTION_FEEDBACK_EVENTS.STOP_EVENT, handleStop)
    }
  }, [])

  return (
    <div
      className={`${styles.wrap} ${feedback.visible ? styles.wrapVisible : ""}`}
      aria-hidden={!feedback.visible}
    >
      {feedback.mode === "loading" ? <div className={styles.bar} /> : null}
      <div
        className={`${styles.pill} ${
          feedback.tone === "success"
            ? styles.pillSuccess
            : feedback.tone === "error"
              ? styles.pillError
              : styles.pillInfo
        }`}
      >
        <span
          className={`${styles.dot} ${
            feedback.tone === "success"
              ? styles.dotSuccess
              : feedback.tone === "error"
                ? styles.dotError
                : styles.dotInfo
          }`}
        />
        <span>{feedback.label}</span>
      </div>
    </div>
  )
}
