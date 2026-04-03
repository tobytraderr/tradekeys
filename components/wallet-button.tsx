"use client"

import { useWallet } from "@/components/wallet-provider"

function shorten(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export function WalletButton() {
  const { account, connecting, connect, disconnect } = useWallet()

  if (account) {
    return (
      <button className="wallet-button" type="button" onClick={disconnect}>
        {shorten(account)}
      </button>
    )
  }

  return (
    <button className="wallet-button" type="button" onClick={() => void connect()} disabled={connecting}>
      {connecting ? "Connecting..." : "Connect Wallet"}
    </button>
  )
}
