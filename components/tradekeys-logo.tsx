import { useId } from "react"
import styles from "./tradekeys-logo.module.css"

type TradeKeysLogoProps = {
  className?: string
  compact?: boolean
}

export function TradeKeysLogo({ className, compact = false }: TradeKeysLogoProps) {
  const gradientId = useId().replace(/:/g, "")
  const lockupClassName = [styles.lockup, compact ? styles.compact : "", className ?? ""]
    .filter(Boolean)
    .join(" ")

  return (
    <div className={lockupClassName} aria-label="TradeKeys">
      <svg
        className={styles.mark}
        viewBox="0 0 256 256"
        role="img"
        aria-hidden="true"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient
            id={gradientId}
            x1="42"
            y1="48"
            x2="214"
            y2="202"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#63F9BB" />
            <stop offset="1" stopColor="#A3A6FF" />
          </linearGradient>
        </defs>
        <rect
          x="36"
          y="46"
          width="94"
          height="94"
          rx="30"
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth="16"
        />
        <rect x="58" y="92" width="12" height="24" rx="6" fill="#63F9BB" />
        <rect x="78" y="78" width="12" height="38" rx="6" fill="#63F9BB" />
        <rect x="98" y="64" width="12" height="52" rx="6" fill="#A3A6FF" />
        <rect x="118" y="92" width="96" height="20" rx="10" fill={`url(#${gradientId})`} />
        <rect x="154" y="110" width="24" height="44" rx="10" fill={`url(#${gradientId})`} />
        <rect x="188" y="110" width="24" height="28" rx="10" fill={`url(#${gradientId})`} />
      </svg>
      {compact ? null : (
        <span className={styles.wordmark}>
          <span className={styles.trade}>Trade</span>
          <span className={styles.keys}>Keys</span>
        </span>
      )}
    </div>
  )
}
