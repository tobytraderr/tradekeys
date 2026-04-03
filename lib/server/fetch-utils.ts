import "server-only"

import {
  recordOpsEvent,
  recordUpstreamFailure,
  recordUpstreamSuccess,
} from "@/lib/server/ops-observability"

type FetchRetryOptions = {
  attempts?: number
  timeoutMs?: number
  initialBackoffMs?: number
  maxBackoffMs?: number
  dependency?: string
  operation?: string
  shouldRetry?: (input: { attempt: number; response?: Response; error?: unknown }) => boolean
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryableError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return true
  }

  const message = error instanceof Error ? error.message : String(error ?? "")
  return /timeout|timed out|network|fetch failed|econnreset|enotfound|socket/i.test(message)
}

function defaultShouldRetry(input: { response?: Response; error?: unknown }) {
  if (input.response) {
    return input.response.status >= 500 || input.response.status === 429
  }

  return isRetryableError(input.error)
}

export async function fetchWithRetry(
  input: string | URL,
  init?: RequestInit,
  options?: FetchRetryOptions
): Promise<Response> {
  const attempts = Math.max(1, options?.attempts ?? 3)
  const timeoutMs = Math.max(1_000, options?.timeoutMs ?? 8_000)
  const initialBackoffMs = Math.max(100, options?.initialBackoffMs ?? 500)
  const maxBackoffMs = Math.max(initialBackoffMs, options?.maxBackoffMs ?? 4_000)
  const shouldRetry = options?.shouldRetry ?? defaultShouldRetry
  const dependency = options?.dependency ?? "app"
  const operation = options?.operation ?? "fetch"

  let lastError: unknown = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const startedAt = Date.now()

    try {
      const response = await fetch(input, {
        ...init,
        signal: init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal,
      })
      const durationMs = Date.now() - startedAt

      if (!shouldRetry({ attempt, response }) || attempt === attempts) {
        recordUpstreamSuccess({
          dependency,
          operation,
          statusCode: response.status,
          durationMs,
        })
        return response
      }

      lastError = new Error(`Request failed with status ${response.status}`)
      recordUpstreamFailure({
        dependency,
        operation,
        error: lastError,
        statusCode: response.status,
        durationMs,
        data: { attempt },
      })
    } catch (error) {
      const durationMs = Date.now() - startedAt
      lastError = error
      recordUpstreamFailure({
        dependency,
        operation,
        error,
        durationMs,
        data: { attempt },
      })
      if (!shouldRetry({ attempt, error }) || attempt === attempts) {
        throw error
      }
    } finally {
      clearTimeout(timeout)
    }

    const backoff = Math.min(initialBackoffMs * 2 ** (attempt - 1), maxBackoffMs)
    recordOpsEvent({
      level: "warn",
      category: "upstream",
      name: `${operation}.retrying`,
      message: `${operation} retry scheduled`,
      dependency,
      data: { attempt, backoffMs: backoff },
    })
    await sleep(backoff)
  }

  throw lastError instanceof Error ? lastError : new Error("Request failed.")
}

export async function fetchJsonWithRetry<T>(
  input: string | URL,
  init?: RequestInit,
  options?: FetchRetryOptions
): Promise<T> {
  const response = await fetchWithRetry(input, init, options)
  return (await response.json()) as T
}
