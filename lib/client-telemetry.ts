"use client"

type TelemetryPayload = {
  name: "wallet_connect_failure" | "transaction_submission_failure"
  message: string
  data?: Record<string, unknown>
}

export function sendClientTelemetry(payload: TelemetryPayload) {
  const body = JSON.stringify(payload)

  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const blob = new Blob([body], { type: "application/json" })
    navigator.sendBeacon("/api/telemetry", blob)
    return
  }

  void fetch("/api/telemetry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    // Best-effort telemetry only.
  })
}
