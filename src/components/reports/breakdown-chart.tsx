"use client"

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  MINOR_PER_RUPEE,
  formatTick,
  niceAxis,
  type AxisSpec,
} from "@/lib/chart-axis"

const config = {
  value: {
    label: "Value",
    color: "var(--primary)",
  },
} satisfies ChartConfig

type BreakdownChartProps = {
  data: { label: string; value: number }[]
  color?: string
  formatter?: (value: number) => string
  /** Values are money in minor units (paise); axis/tooltips render rupees. */
  money?: boolean
}

export function BreakdownChart({
  data,
  color = "var(--primary)",
  formatter,
  money = false,
}: BreakdownChartProps) {
  const toPlotUnit = (v: number) => (money ? v / MINOR_PER_RUPEE : v)
  const maxPlot = data.reduce((acc, d) => Math.max(acc, toPlotUnit(d.value)), 0)
  const axis: AxisSpec = niceAxis(maxPlot, 4, !money)

  return (
    <ChartContainer config={config} className="h-56 w-full">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          fontSize={12}
          interval="preserveStartEnd"
        />
        <YAxis
          width={money ? 52 : 30}
          tickLine={false}
          axisLine={false}
          fontSize={12}
          allowDecimals={!money}
          domain={[0, axis.domainMax]}
          ticks={axis.ticks}
          tickFormatter={(v) => formatTick(v, money)}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              formatter={(value) =>
                formatter ? [formatter(Number(value)), "Value"] : [Number(value).toLocaleString(), "Value"]
              }
              indicator="dot"
            />
          }
        />
        <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} maxBarSize={36} />
      </BarChart>
    </ChartContainer>
  )
}
