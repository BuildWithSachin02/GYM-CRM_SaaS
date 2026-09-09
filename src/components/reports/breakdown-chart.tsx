"use client"

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"

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
}

export function BreakdownChart({
  data,
  color = "var(--primary)",
  formatter,
}: BreakdownChartProps) {
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
          width={42}
          tickLine={false}
          axisLine={false}
          fontSize={12}
          allowDecimals={false}
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
