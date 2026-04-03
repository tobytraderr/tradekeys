import { bsc } from "viem/chains"
import type { TwinCreationQuote, TwinQuote } from "@/lib/types"

export type ExecutionUiFeedback = {
  tone: "success" | "error" | "warning"
  title: string
  body: string
}

export function isQuoteExpired(quote: Pick<TwinQuote, "expiresAt"> | Pick<TwinCreationQuote, "expiresAt"> | null | undefined) {
  if (!quote?.expiresAt) return true
  return Date.now() >= Date.parse(quote.expiresAt)
}

export function didTwinQuoteChange(previous: TwinQuote | null, next: TwinQuote) {
  if (!previous) return true

  return (
    previous.amount !== next.amount ||
    previous.buyQuoteWei !== next.buyQuoteWei ||
    previous.sellQuoteWei !== next.sellQuoteWei ||
    (previous.holderBalanceWei ?? previous.holderBalance ?? "0") !==
      (next.holderBalanceWei ?? next.holderBalance ?? "0")
  )
}

export function didCreateQuoteChange(previous: TwinCreationQuote | null, next: TwinCreationQuote) {
  if (!previous) return true

  return (
    previous.requiredValueWei !== next.requiredValueWei ||
    previous.owner.toLowerCase() !== next.owner.toLowerCase() ||
    previous.exists !== next.exists ||
    previous.isClaimed !== next.isClaimed
  )
}

export function getWalletExecutionState(input: {
  account: string | null
  chainId: number | null
  connecting: boolean
  browseDataWarning?: string
}) {
  if (!input.account) {
    return {
      tone: "warning" as const,
      headline: input.connecting ? "Connecting wallet" : "Wallet required",
    }
  }

  if (input.chainId !== bsc.id) {
    return {
      tone: "warning" as const,
      headline: "Wrong network",
    }
  }

  if (input.browseDataWarning) {
    return {
      tone: "warning" as const,
      headline: "Browse data delayed",
    }
  }

  return {
    tone: "ready" as const,
    headline: "Execution ready",
  }
}

export function mapExecutionError(action: "buy" | "sell" | "create", error: unknown): ExecutionUiFeedback {
  const raw = error instanceof Error ? error.message : `${action} action failed.`
  const message = raw.toLowerCase()

  if (
    message.includes("user rejected") ||
    message.includes("user denied") ||
    message.includes("rejected the request") ||
    message.includes("request rejected")
  ) {
    return {
      tone: "error",
      title: "Transaction cancelled",
      body: "The wallet request was dismissed before submission completed.",
    }
  }

  if (message.includes("wallet is required") || message.includes("browser wallet")) {
    return {
      tone: "error",
      title: "Wallet not available",
      body: "Open a browser wallet like MetaMask to continue.",
    }
  }

  if (
    message.includes("wallet_switchethereumchain") ||
    message.includes("wrong network") ||
    message.includes("switch") ||
    message.includes("0x38")
  ) {
    return {
      tone: "error",
      title: "Wrong network",
      body: "Switch your wallet to BNB Smart Chain and try again.",
    }
  }

  if (message.includes("insufficient")) {
    return {
      tone: "error",
      title: "Insufficient balance",
      body:
        action === "sell"
          ? "Your wallet does not hold enough keys for this sell amount."
          : "Your wallet balance is not enough to cover the latest live quote and gas.",
    }
  }

  if (message.includes("quote")) {
    return {
      tone: "error",
      title: "Quote unavailable",
      body: "The latest live execution quote could not be refreshed. Try again in a moment.",
    }
  }

  if (message.includes("amount")) {
    return {
      tone: "error",
      title: "Invalid amount",
      body: "Enter a whole number greater than zero before submitting.",
    }
  }

  if (action === "create" && message.includes("url")) {
    return {
      tone: "error",
      title: "Metadata URL required",
      body: "Enter a valid metadata URL before launching the twin.",
    }
  }

  if (action === "create" && (message.includes("exists") || message.includes("already"))) {
    return {
      tone: "error",
      title: "Twin already exists",
      body: "This twin ID is already live onchain. Choose another bytes16 twin ID.",
    }
  }

  if (action === "create" && (message.includes("claim") || message.includes("owner"))) {
    return {
      tone: "error",
      title: "Twin is pre-claimed",
      body: "This twin ID is already reserved for another owner wallet.",
    }
  }

  return {
    tone: "error",
    title: `${action === "create" ? "Create" : action === "buy" ? "Buy" : "Sell"} action failed`,
    body: "The live execution flow did not complete. Refresh the quote and try again.",
  }
}

export function buildRequotePrompt(action: "buy" | "sell" | "create"): ExecutionUiFeedback {
  const subject =
    action === "create" ? "creation quote" : action === "buy" ? "buy quote" : "sell quote"

  return {
    tone: "warning",
    title: "Quote refreshed",
    body: `The live ${subject} changed or expired. Review the updated value and submit again.`,
  }
}
