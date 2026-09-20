"use client"

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  exactMoney,
  formatTick,
  moneyAxisFromMinor,
} from "@/lib/chart-axis"
import { minorToRupees } from "@/lib/format"

const config = {
  revenue: {
    label: "Revenue",
    color: "var(--primary)",
  },
} satisfies ChartConfig

type RevenueTrendChartProps = {
  data: { day: string; revenue: number }[]
}

/**
 * Revenue trend area chart.
 *
 * UNIT RULE: `revenue` is stored as integer minor units (paise). The chart
 * converts to RUPEES exactly once, at the boundary (plotData), and everything
 * drawn — area geometry, axis, tooltip — works in rupees. A raw paise value is
 * never plotted against a rupee axis.
 */
export function RevenueTrendChart({ data }: RevenueTrendChartProps) {
  const maxMinor = data.reduce((acc, d) => Math.max(acc, d.revenue), 0)
  const axis = moneyAxisFromMinor(maxMinor)
  const plotData = data.map((d) => ({ day: d.day, revenue: minorToRupees(d.revenue) }))

  return (
    <ChartContainer config={config} className="h-56 w-full">
      <AreaChart data={plotData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="fillRevenue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--primary)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey="day"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          fontSize={12}
          interval="preserveStartEnd"
          tickFormatter={(v) => v}
        />
        <YAxis
          width={52}
          tickLine={false}
          axisLine={false}
          fontSize={12}
          domain={[0, axis.domainMax]}
          ticks={axis.ticks}
          tickFormatter={(v) => formatTick(v, true)}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              formatter={(value) => (
                <>
                  <span className="font-mono font-medium text-foreground tabular-nums">
                    {exactMoney(Number(value))}
                  </span>
                  <span className="text-muted-foreground">Revenue</span>
                </>
              )}
              indicator="dot"
            />
          }
        />
        <Area
          dataKey="revenue"
          type="monotone"
          stroke="var(--primary)"
          fill="url(#fillRevenue)"
          strokeWidth={2}
        />
      </AreaChart>
    </ChartContainer>
  )
}