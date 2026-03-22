import * as React from 'react'
import * as RechartsPrimitive from 'recharts'

import { cn } from '@/lib/utils'

export type ChartConfig = Record<
  string,
  {
    color?: string
    label?: string
  }
>

interface ChartContextValue {
  config: ChartConfig
}

const ChartContext = React.createContext<ChartContextValue | null>(null)

function useChart() {
  const context = React.useContext(ChartContext)

  if (!context) {
    throw new Error('Chart components must be used within a ChartContainer.')
  }

  return context
}

export const ChartContainer = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<'div'> & {
    config: ChartConfig
  }
>(({ children, className, config, style, ...props }, ref) => {
  const chartStyle = {
    ...style,
    ...Object.fromEntries(
      Object.entries(config).flatMap(([key, value]) =>
        value.color ? [[`--color-${key}`, value.color]] : [],
      ),
    ),
  } as React.CSSProperties

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        ref={ref}
        className={cn(
          'flex aspect-[1.7] w-full items-center justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line]:stroke-border/70 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-dot[stroke="#fff"]]:stroke-transparent [&_.recharts-layer]:outline-none [&_.recharts-reference-line_[stroke="#ccc"]]:stroke-border [&_.recharts-surface]:overflow-visible',
          className,
        )}
        style={chartStyle}
        {...props}
      >
        {children}
      </div>
    </ChartContext.Provider>
  )
})
ChartContainer.displayName = 'ChartContainer'

export function ChartTooltip(
  props: React.ComponentProps<typeof RechartsPrimitive.Tooltip>,
) {
  return <RechartsPrimitive.Tooltip {...props} />
}

export function ChartTooltipContent({
  active,
  className,
  formatter,
  hideLabel = false,
  label,
  labelFormatter,
  payload,
}: {
  active?: boolean
  className?: string
  formatter?: (
    value: unknown,
    name: string,
    item: { color?: string; dataKey?: string | number; name?: string; value?: unknown },
    payload: Array<{ color?: string; dataKey?: string | number; name?: string; value?: unknown }>,
  ) => React.ReactNode
  hideLabel?: boolean
  label?: string | number
  labelFormatter?: (
    label: string | number,
    payload: Array<{ color?: string; dataKey?: string | number; name?: string; value?: unknown }>,
  ) => React.ReactNode
  payload?: Array<{ color?: string; dataKey?: string | number; name?: string; value?: unknown }>
} & {
  hideLabel?: boolean
}) {
  const { config } = useChart()

  if (!active || !payload?.length) {
    return null
  }

  return (
    <div
      className={cn(
        'min-w-[11rem] rounded-none border border-border bg-card/96 px-3 py-2 text-card-foreground shadow-xl backdrop-blur',
        className,
      )}
    >
      {!hideLabel ? (
        <p className="mb-2 text-[11px] font-medium text-muted-foreground">
          {labelFormatter ? labelFormatter(label ?? '', payload) : label}
        </p>
      ) : null}
      <div className="space-y-1.5">
        {payload.map((item) => {
          const key = `${item.dataKey ?? item.name ?? 'value'}`
          const itemConfig = config[key]

          return (
            <div key={key} className="flex items-center justify-between gap-3 text-[11px]">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className="size-2.5 shrink-0 rounded-none"
                  style={{
                    backgroundColor:
                      item.color ?? itemConfig?.color ?? 'var(--foreground)',
                  }}
                />
                <span className="truncate text-muted-foreground">
                  {itemConfig?.label ?? item.name ?? key}
                </span>
              </div>
                <span className="font-medium text-foreground">
                {formatter
                  ? formatter(item.value, `${item.name ?? key}`, item, payload)
                  : `${item.value ?? ''}`}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
