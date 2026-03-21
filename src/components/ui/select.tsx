import { ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface SelectOption {
  label: string
  value: string
}

interface SelectProps {
  ariaLabel: string
  className?: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  selectClassName?: string
  value: string
}

function Select({
  ariaLabel,
  className,
  onValueChange,
  options,
  selectClassName,
  value,
}: SelectProps) {
  return (
    <div className={cn('relative min-w-0', className)}>
      <select
        aria-label={ariaLabel}
        className={cn(
          'h-10 w-full appearance-none border border-border bg-background px-3 pr-9 text-sm text-foreground outline-none transition-colors focus:border-foreground',
          selectClassName,
        )}
        onChange={(event) => onValueChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  )
}

export { Select }
