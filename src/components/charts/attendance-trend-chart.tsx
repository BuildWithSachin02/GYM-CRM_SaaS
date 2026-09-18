"use client"

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { formatTick, niceAxis, type AxisSpec } from "@/lib/chart-axis"

const config = {
  count: {
    label: "Check-ins",
    color: "var(--primary)",
  },
} satisfies ChartConfig

type AttendanceTrendChartProps = {
  data: { day: string; count: number }[]
}

export function AttendanceTrendChart({ data }: AttendanceTrendChartProps) {
  const maxCount = data.reduce((acc, d) => Math.max(acc, d.count), 0)
  const axis: AxisSpec = niceAxis(maxCount, 4, true)

  return (
    <ChartContainer config={config} className="h-56 w-full">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
          width={30}
          tickLine={false}
          axisLine={false}
          fontSize={12}
          allowDecimals={false}
          domain={[0, axis.domainMax]}
          ticks={axis.ticks}
          tickFormatter={(v) => formatTick(v, false)}
        />
        <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
        <Bar dataKey="count" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={24} />
      </BarChart>
    </ChartContainer>
  )
}