type IconName =
  | "search"
  | "wallet"
  | "home"
  | "list"
  | "pie"
  | "history"
  | "brain"
  | "settings"
  | "help"
  | "code"
  | "plus"
  | "arrow-left"
  | "arrow-right"
  | "spark"
  | "buy"
  | "sell"
  | "share"
  | "star"
  | "menu"
  | "close"
  | "user"
  | "robot"
  | "shield"
  | "lock"
  | "key"

type Props = {
  name: IconName
  className?: string
}

export function UiIcon({ name, className }: Props) {
  const commonProps = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  }

  switch (name) {
    case "search":
      return (
        <svg {...commonProps}>
          <circle cx="11" cy="11" r="6.5" />
          <path d="M16 16l4.5 4.5" />
        </svg>
      )
    case "wallet":
      return (
        <svg {...commonProps}>
          <path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h11a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 17 19H6a2.5 2.5 0 0 1-2.5-2.5z" />
          <path d="M15 12h5" />
          <circle cx="16.5" cy="12" r="0.75" fill="currentColor" stroke="none" />
        </svg>
      )
    case "home":
      return (
        <svg {...commonProps}>
          <path d="M4 10.5L12 4l8 6.5" />
          <path d="M6.5 9.5V20h11V9.5" />
        </svg>
      )
    case "list":
      return (
        <svg {...commonProps}>
          <path d="M8 7h11" />
          <path d="M8 12h11" />
          <path d="M8 17h11" />
          <circle cx="4.5" cy="7" r="1" fill="currentColor" stroke="none" />
          <circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="4.5" cy="17" r="1" fill="currentColor" stroke="none" />
        </svg>
      )
    case "pie":
      return (
        <svg {...commonProps}>
          <path d="M12 3v9h9" />
          <path d="M20.5 13A8.5 8.5 0 1 1 11 3.5" />
        </svg>
      )
    case "history":
      return (
        <svg {...commonProps}>
          <path d="M4.5 5.5V10H9" />
          <path d="M5 15a7 7 0 1 0 2-7" />
          <path d="M12 8v4l3 2" />
        </svg>
      )
    case "brain":
      return (
        <svg {...commonProps}>
          <path d="M9 4.5a3 3 0 0 0-3 3v.5A3.5 3.5 0 0 0 4.5 14a3 3 0 0 0 4 4.5" />
          <path d="M15 4.5a3 3 0 0 1 3 3v.5A3.5 3.5 0 0 1 19.5 14a3 3 0 0 1-4 4.5" />
          <path d="M9 8.5c0-1.5 1.1-2.5 3-2.5s3 1 3 2.5" />
          <path d="M12 6v12" />
          <path d="M8.5 12h7" />
        </svg>
      )
    case "settings":
      return (
        <svg {...commonProps}>
          <circle cx="12" cy="12" r="3.2" />
          <path d="M12 2.8v2.1" />
          <path d="M12 19.1v2.1" />
          <path d="M4.8 4.8l1.5 1.5" />
          <path d="M17.7 17.7l1.5 1.5" />
          <path d="M2.8 12h2.1" />
          <path d="M19.1 12h2.1" />
          <path d="M4.8 19.2l1.5-1.5" />
          <path d="M17.7 6.3l1.5-1.5" />
        </svg>
      )
    case "help":
      return (
        <svg {...commonProps}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.6 9.2a2.7 2.7 0 1 1 4.6 2c-.9.8-1.7 1.3-1.7 2.5" />
          <path d="M12 17h.01" />
        </svg>
      )
    case "code":
      return (
        <svg {...commonProps}>
          <path d="M8.5 8.5L4.5 12l4 3.5" />
          <path d="M15.5 8.5l4 3.5-4 3.5" />
          <path d="M13.5 5.5l-3 13" />
        </svg>
      )
    case "plus":
      return (
        <svg {...commonProps}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v8" />
          <path d="M8 12h8" />
        </svg>
      )
    case "arrow-left":
      return (
        <svg {...commonProps}>
          <path d="M15 18l-6-6 6-6" />
        </svg>
      )
    case "arrow-right":
      return (
        <svg {...commonProps}>
          <path d="M9 18l6-6-6-6" />
        </svg>
      )
    case "spark":
      return (
        <svg {...commonProps}>
          <path d="M12 3l1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3z" />
        </svg>
      )
    case "buy":
      return (
        <svg {...commonProps}>
          <path d="M7 17L17 7" />
          <path d="M10 7h7v7" />
        </svg>
      )
    case "sell":
      return (
        <svg {...commonProps}>
          <path d="M7 7l10 10" />
          <path d="M10 17h7v-7" />
        </svg>
      )
    case "share":
      return (
        <svg {...commonProps}>
          <circle cx="18" cy="5.5" r="2.2" />
          <circle cx="6" cy="12" r="2.2" />
          <circle cx="18" cy="18.5" r="2.2" />
          <path d="M8 11l7.8-4.1" />
          <path d="M8 13l7.8 4.1" />
        </svg>
      )
    case "star":
      return (
        <svg {...commonProps}>
          <path d="M12 3.8l2.6 5.2 5.8.8-4.2 4 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.2-4 5.8-.8L12 3.8z" />
        </svg>
      )
    case "menu":
      return (
        <svg {...commonProps}>
          <path d="M4 7h16" />
          <path d="M4 12h16" />
          <path d="M4 17h16" />
        </svg>
      )
    case "close":
      return (
        <svg {...commonProps}>
          <path d="M6 6l12 12" />
          <path d="M18 6L6 18" />
        </svg>
      )
    case "user":
      return (
        <svg {...commonProps}>
          <circle cx="12" cy="8" r="3.25" />
          <path d="M5.5 19a6.5 6.5 0 0 1 13 0" />
        </svg>
      )
    case "robot":
      return (
        <svg {...commonProps}>
          <path d="M9 4.5h6" />
          <path d="M12 2.5v2" />
          <rect x="5" y="6.5" width="14" height="10.5" rx="3" />
          <circle cx="9.5" cy="11.5" r="0.9" fill="currentColor" stroke="none" />
          <circle cx="14.5" cy="11.5" r="0.9" fill="currentColor" stroke="none" />
          <path d="M9 15h6" />
        </svg>
      )
    case "lock":
      return (
        <svg {...commonProps}>
          <rect x="6.5" y="10" width="11" height="9.5" rx="2" />
          <path d="M9 10V7.8A3 3 0 0 1 12 5a3 3 0 0 1 3 2.8V10" />
        </svg>
      )
    case "key":
      return (
        <svg {...commonProps}>
          <circle cx="8.5" cy="12" r="3.2" />
          <path d="M11.7 12H20" />
          <path d="M16 12v2.3" />
          <path d="M18.2 12v1.5" />
        </svg>
      )
    case "shield":
      return (
        <svg {...commonProps}>
          <path d="M12 3l7 3.2V11c0 4.2-2.7 7.7-7 10-4.3-2.3-7-5.8-7-10V6.2L12 3z" />
          <path d="M9.5 12.2l1.7 1.7 3.4-3.6" />
        </svg>
      )
    default:
      return null
  }
}
