"use client"

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"

const config = {
  revenue: {
    label: "Revenue",
    color: "var(--primary)",
  },
} satisfies ChartConfig

type RevenueTrendChartProps = {
  data: { day: string; revenue: number }[]
}

export function RevenueTrendChart({ data }: RevenueTrendChartProps) {
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
          width={42}
          tickLine={false}
          axisLine={false}
          fontSize={12}
          tickFormatter={(v: number) =>
            v === 0 ? "0" : `${v >= 100000 ? `${Math.round(v / 1000)}k` : Math.round(v / 100)}`
          }
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              formatter={(value) => [
                new Intl.NumberFormat("en-IN", {
                  style: "currency",
                  currency: "INR",
                  maximumFractionDigits: 0,
                }).format(Number(value)),
                "Revenue",
              ]}
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