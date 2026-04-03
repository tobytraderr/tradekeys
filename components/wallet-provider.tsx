"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { sendClientTelemetry } from "@/lib/client-telemetry"
import { clearWalletSession, ensureWalletSession } from "@/lib/wallet-session-client"

type WalletContextValue = {
  account: `0x${string}` | null
  chainId: number | null
  connecting: boolean
  error: string | null
  connect: () => Promise<void>
  ensureSession: () => Promise<void>
  disconnect: () => void
}

const WalletContext = createContext<WalletContextValue | null>(null)

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>
      on?: (event: string, handler: (...args: unknown[]) => void) => void
      removeListener?: (event: string, handler: (...args: unknown[]) => void) => void
    }
  }
}

function normalizeAccount(value: unknown): `0x${string}` | null {
  if (typeof value !== "string" || !value.startsWith("0x")) {
    return null
  }
  return value as `0x${string}`
}

function parseHexChainId(value: unknown): number | null {
  if (typeof value !== "string") return null
  try {
    return Number.parseInt(value, 16)
  } catch {
    return null
  }
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<`0x${string}` | null>(null)
  const [chainId, setChainId] = useState<number | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const readInitialState = useCallback(async () => {
    if (!window.ethereum) return
    try {
      const [accounts, chain] = await Promise.all([
        window.ethereum.request({ method: "eth_accounts" }),
        window.ethereum.request({ method: "eth_chainId" }),
      ])
      const first = Array.isArray(accounts) ? normalizeAccount(accounts[0]) : null
      setAccount(first)
      setChainId(parseHexChainId(chain))
    } catch {
      // silent on passive read
    }
  }, [])

  useEffect(() => {
    void readInitialState()
  }, [readInitialState])

  useEffect(() => {
    if (!window.ethereum?.on) return

    const handleAccountsChanged = (accounts: unknown) => {
      const first = Array.isArray(accounts) ? normalizeAccount(accounts[0]) : null
      setAccount(first)
    }

    const handleChainChanged = (value: unknown) => {
      setChainId(parseHexChainId(value))
    }

    window.ethereum.on("accountsChanged", handleAccountsChanged)
    window.ethereum.on("chainChanged", handleChainChanged)

    return () => {
      window.ethereum?.removeListener?.("accountsChanged", handleAccountsChanged)
      window.ethereum?.removeListener?.("chainChanged", handleChainChanged)
    }
  }, [])

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      setError("MetaMask or another EIP-1193 wallet is required.")
      return
    }
    setConnecting(true)
    setError(null)
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" })
      const chain = await window.ethereum.request({ method: "eth_chainId" })
      const first = Array.isArray(accounts) ? normalizeAccount(accounts[0]) : null
      setAccount(first)
      setChainId(parseHexChainId(chain))
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Wallet connection failed."
      setError(message)
      sendClientTelemetry({
        name: "wallet_connect_failure",
        message,
      })
    } finally {
      setConnecting(false)
    }
  }, [])

  const disconnect = useCallback(() => {
    setAccount(null)
    setError(null)
    void clearWalletSession()
  }, [])

  const ensureSessionForCurrentWallet = useCallback(async () => {
    if (!account) {
      throw new Error("Connect your wallet to continue.")
    }

    await ensureWalletSession(account)
  }, [account])

  const value = useMemo(
    () => ({
      account,
      chainId,
      connecting,
      error,
      connect,
      ensureSession: ensureSessionForCurrentWallet,
      disconnect,
    }),
    [account, chainId, connect, connecting, disconnect, ensureSessionForCurrentWallet, error]
  )

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

export function useWallet() {
  const value = useContext(WalletContext)
  if (!value) {
    throw new Error("useWallet must be used within WalletProvider")
  }
  return value
}
