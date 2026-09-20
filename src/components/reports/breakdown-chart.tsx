"use client"

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
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
  niceAxis,
  type AxisSpec,
} from "@/lib/chart-axis"
import { minorToRupees } from "@/lib/format"

const config = {
  value: {
    label: "Value",
    color: "var(--primary)",
  },
} satisfies ChartConfig

type BreakdownChartProps = {
  data: { label: string; value: number }[]
  color?: string
  /** Values are money in minor units (paise); converted to rupees once at the plot boundary. */
  money?: boolean
}

export function BreakdownChart({
  data,
  color = "var(--primary)",
  money = false,
}: BreakdownChartProps) {
  const maxMinor = data.reduce((acc, d) => Math.max(acc, d.value), 0)
  const axis: AxisSpec = money
    ? moneyAxisFromMinor(maxMinor)
    : niceAxis(maxMinor, 4, true)
  const toPlotUnit = (v: number) => (money ? minorToRupees(v) : v)
  const plotData = data.map((d) => ({ ...d, value: toPlotUnit(d.value) }))

  return (
    <ChartContainer config={config} className="h-56 w-full">
      <BarChart data={plotData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
              formatter={(value) => (
                <>
                  <span className="font-mono font-medium text-foreground tabular-nums">
                    {money ? exactMoney(Number(value)) : Number(value).toLocaleString()}
                  </span>
                  <span className="text-muted-foreground">Value</span>
                </>
              )}
              indicator="dot"
            />
          }
        />
        <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} maxBarSize={36} />
      </BarChart>
    </ChartContainer>
  )
}
