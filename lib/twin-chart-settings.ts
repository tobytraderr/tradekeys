import {
  ColorType,
  CrosshairMode,
  type DeepPartial,
  type ChartOptions,
} from "lightweight-charts"

export type TwinChartRangeKey = "1H" | "24H" | "7D" | "30D" | "ALL"

export type TwinChartSettings = {
  defaultRange: TwinChartRangeKey
  ranges: Array<{
    key: TwinChartRangeKey
    seconds?: number
  }>
  markerLimit: number
  mobileBreakpoint: number
  chartOptions: DeepPartial<ChartOptions>
  candle: {
    upColor: string
    downColor: string
    borderVisible: boolean
    lastValueVisible: boolean
    priceLineVisible: boolean
  }
  volume: {
    upColor: string
    downColor: string
    scaleMargins: {
      top: number
      bottom: number
    }
  }
}

export const twinChartSettings: TwinChartSettings = {
  defaultRange: "24H",
  ranges: [
    { key: "1H", seconds: 60 * 60 },
    { key: "24H", seconds: 24 * 60 * 60 },
    { key: "7D", seconds: 7 * 24 * 60 * 60 },
    { key: "30D", seconds: 30 * 24 * 60 * 60 },
    { key: "ALL" },
  ],
  markerLimit: 8,
  mobileBreakpoint: 900,
  chartOptions: {
    layout: {
      background: { type: ColorType.Solid, color: "transparent" },
      textColor: "#a9abaf",
      fontFamily:
        'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      attributionLogo: true,
    },
    grid: {
      vertLines: { color: "rgba(255,255,255,0.03)" },
      horzLines: { color: "rgba(255,255,255,0.05)" },
    },
    crosshair: {
      mode: CrosshairMode.Magnet,
      vertLine: { color: "rgba(163,166,255,0.35)", labelBackgroundColor: "#171c22" },
      horzLine: { color: "rgba(99,249,187,0.3)", labelBackgroundColor: "#171c22" },
    },
    rightPriceScale: {
      borderVisible: false,
      scaleMargins: {
        top: 0.08,
        bottom: 0.28,
      },
    },
    timeScale: {
      borderVisible: false,
      timeVisible: true,
      secondsVisible: false,
    },
  },
  candle: {
    upColor: "#63f9bb",
    downColor: "#ff6e84",
    borderVisible: false,
    lastValueVisible: true,
    priceLineVisible: false,
  },
  volume: {
    upColor: "rgba(99, 249, 187, 0.22)",
    downColor: "rgba(255, 110, 132, 0.18)",
    scaleMargins: {
      top: 0.72,
      bottom: 0,
    },
  },
}

export function getTwinChartRangeSeconds(range: TwinChartRangeKey) {
  return twinChartSettings.ranges.find((item) => item.key === range)?.seconds
}
