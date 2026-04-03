"use client"

type ActionFeedbackStartDetail = {
  label?: string
  persistent?: boolean
}

type ActionFeedbackNoticeDetail = {
  label: string
  tone?: "info" | "success" | "error"
  durationMs?: number
}

const START_EVENT = "tradekeys:action-feedback:start"
const STOP_EVENT = "tradekeys:action-feedback:stop"
const NOTICE_EVENT = "tradekeys:action-feedback:notice"

export function startActionFeedback(detail?: ActionFeedbackStartDetail) {
  if (typeof window === "undefined") {
    return
  }

  window.dispatchEvent(new CustomEvent(START_EVENT, { detail }))
}

export function stopActionFeedback() {
  if (typeof window === "undefined") {
    return
  }

  window.dispatchEvent(new CustomEvent(STOP_EVENT))
}

export function showActionFeedbackNotice(detail: ActionFeedbackNoticeDetail) {
  if (typeof window === "undefined") {
    return
  }

  window.dispatchEvent(new CustomEvent(NOTICE_EVENT, { detail }))
}

export const ACTION_FEEDBACK_EVENTS = {
  START_EVENT,
  STOP_EVENT,
  NOTICE_EVENT,
}
