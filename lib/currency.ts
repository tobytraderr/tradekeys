export function formatUsd(
  value: number,
  options?: {
    maximumFractionDigits?: number
    minimumFractionDigits?: number
  }
) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: options?.maximumFractionDigits ?? 2,
    minimumFractionDigits: options?.minimumFractionDigits ?? 2,
  }).format(Number.isFinite(value) ? value : 0)
}

export function formatCompactUsd(value: number) {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) {
    return `${value < 0 ? "-" : ""}$${(abs / 1_000_000).toFixed(1)}m`
  }
  if (abs >= 1_000) {
    return `${value < 0 ? "-" : ""}$${(abs / 1_000).toFixed(1)}k`
  }
  return formatUsd(value, { maximumFractionDigits: 0, minimumFractionDigits: 0 })
}

export function convertBnbToUsd(amountBnb: number, usdPerBnb: number) {
  if (!Number.isFinite(amountBnb) || !Number.isFinite(usdPerBnb)) return 0
  return amountBnb * usdPerBnb
}
