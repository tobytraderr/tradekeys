"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  CandlestickSeries,
  HistogramSeries,
  createChart,
  createSeriesMarkers,
  type UTCTimestamp,
} from "lightweight-charts"
import { formatUsd } from "@/lib/currency"
import {
  getTwinChartRangeSeconds,
  twinChartSettings,
  type TwinChartRangeKey,
} from "@/lib/twin-chart-settings"
import type { TwinChartPoint, TwinDetailTrade } from "@/lib/types"
import styles from "@/components/twin-price-chart.module.css"

type Props = {
  points: TwinChartPoint[]
  trades: TwinDetailTrade[]
}

function findClosestCandleTime(times: number[], target: number) {
  if (times.length === 0) return undefined
  let closest = times[0]
  let smallestGap = Math.abs(times[0] - target)

  for (const time of times) {
    const gap = Math.abs(time - target)
    if (gap < smallestGap) {
      smallestGap = gap
      closest = time
    }
  }

  return closest
}

export function TwinPriceChart({ points, trades }: Props) {
  const chartRef = useRef<HTMLDivElement | null>(null)
  const [range, setRange] = useState<TwinChartRangeKey>(twinChartSettings.defaultRange)

  const filtered = useMemo(() => {
    if (points.length === 0) {
      return { points: [], trades: [] }
    }

    if (range === "ALL") {
      return { points, trades }
    }

    const latestTime = points[points.length - 1]?.time ?? 0
    const cutoff = latestTime - (getTwinChartRangeSeconds(range) ?? 0)

    return {
      points: points.filter((point) => point.time >= cutoff),
      trades: trades.filter((trade) => trade.timestamp >= cutoff),
    }
  }, [points, range, trades])

  useEffect(() => {
    const container = chartRef.current
    if (!container || filtered.points.length === 0) {
      return
    }

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      ...twinChartSettings.chartOptions,
      localization: {
        priceFormatter: (price: number) =>
          formatUsd(price, { maximumFractionDigits: price >= 1 ? 2 : 4, minimumFractionDigits: 2 }),
      },
    })

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: twinChartSettings.candle.upColor,
      downColor: twinChartSettings.candle.downColor,
      borderVisible: twinChartSettings.candle.borderVisible,
      wickUpColor: twinChartSettings.candle.upColor,
      wickDownColor: twinChartSettings.candle.downColor,
      lastValueVisible: twinChartSettings.candle.lastValueVisible,
      priceLineVisible: twinChartSettings.candle.priceLineVisible,
    })

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: "",
      lastValueVisible: false,
      priceLineVisible: false,
    })
    volumeSeries.priceScale().applyOptions({
      scaleMargins: twinChartSettings.volume.scaleMargins,
    })

    candleSeries.setData(
      filtered.points.map((point) => ({
        time: point.time as UTCTimestamp,
        open: point.openUsd,
        high: point.highUsd,
        low: point.lowUsd,
        close: point.closeUsd,
      }))
    )

    volumeSeries.setData(
      filtered.points.map((point) => ({
        time: point.time as UTCTimestamp,
        value: point.volumeUsd,
        color:
          point.closeUsd >= point.openUsd
            ? twinChartSettings.volume.upColor
            : twinChartSettings.volume.downColor,
      }))
    )

    const candleTimes = filtered.points.map((point) => point.time)
    const markersApi = createSeriesMarkers(candleSeries)
    markersApi.setMarkers(
      filtered.trades.slice(0, twinChartSettings.markerLimit).map((trade) => {
        const markerTime =
          findClosestCandleTime(candleTimes, Math.floor(trade.timestamp / 3600) * 3600) ??
          candleTimes[candleTimes.length - 1]

        return {
          time: markerTime as UTCTimestamp,
          position: trade.isBuy ? "belowBar" : "aboveBar",
          color: trade.isBuy ? "#63f9bb" : "#ff6e84",
          shape: trade.isBuy ? "arrowUp" : "arrowDown",
          text: `${trade.isBuy ? "B" : "S"}${trade.shareAmount}`,
        }
      })
    )

    chart.timeScale().fitContent()

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      chart.applyOptions({ width, height })
      chart.timeScale().fitContent()
    })

    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      chart.remove()
    }
  }, [filtered.points, filtered.trades])

  if (points.length === 0) {
    return (
      <div className={styles.shell}>
        <div className={styles.empty}>No indexed chart history yet for this twin.</div>
      </div>
    )
  }

  const current = filtered.points[filtered.points.length - 1] ?? points[points.length - 1]
  const previous = filtered.points[filtered.points.length - 2] ?? points[points.length - 2]
  const changePct =
    current && previous && previous.closeUsd > 0
      ? ((current.closeUsd - previous.closeUsd) / previous.closeUsd) * 100
      : 0

  return (
    <section className={styles.shell}>
      <div className={styles.header}>
        <div>
          <div className={styles.metricLabel}>Current Price</div>
          <div className={styles.priceRow}>
            <strong className={styles.priceValue}>
              {formatUsd(current?.closeUsd ?? 0, {
                maximumFractionDigits: current?.closeUsd && current.closeUsd < 1 ? 4 : 2,
                minimumFractionDigits: 2,
              })}
            </strong>
            <span className={changePct >= 0 ? styles.changeUp : styles.changeDown}>
              {changePct >= 0 ? "+" : ""}
              {changePct.toFixed(1)}%
            </span>
          </div>
        </div>
        <div className={styles.rangeTabs}>
          {twinChartSettings.ranges.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`${styles.rangeButton} ${
                range === item.key ? styles.rangeButtonActive : ""
              }`}
              onClick={() => setRange(item.key)}
            >
              {item.key}
            </button>
          ))}
        </div>
      </div>
      <div ref={chartRef} className={styles.viewport} />
    </section>
  )
}
