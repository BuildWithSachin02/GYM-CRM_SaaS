"use client"

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  MINOR_PER_RUPEE,
  exactMoney,
  formatTick,
  niceAxis,
  type AxisSpec,
} from "@/lib/chart-axis"

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
 * NOTE ON UNITS: `revenue` is stored as integer minor units (paise). The chart
 * normalizes to RUPEES once, at the boundary, and everything drawn (axis,
 * tooltip) works in rupees. There is intentionally no paise↔rupee conversion
 * inside the render pipeline — see the getRevenueAnalysis contract.
 */
export function RevenueTrendChart({ data }: RevenueTrendChartProps) {
  const toRupees = (minor: number) => minor / MINOR_PER_RUPEE
  const maxRupees = data.reduce((acc, d) => Math.max(acc, toRupees(d.revenue)), 0)
  const axis: AxisSpec = niceAxis(maxRupees, 4, false)

  return (
    <ChartContainer config={config} className="h-56 w-full">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
              formatter={(value) => [exactMoney(toRupees(Number(value))), "Revenue"]}
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