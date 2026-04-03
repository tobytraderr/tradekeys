import "server-only"

import * as legacy from "@/lib/services/market/legacy"

export async function getTwinQuote(
  id: string,
  amount = 1n,
  wallet?: `0x${string}`
) {
  return legacy.getTwinQuote(id, amount, wallet)
}
