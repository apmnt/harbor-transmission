const locale = new Intl.Locale(navigator.language || 'en-US')
const pluralRules = new Intl.PluralRules(locale.baseName)
const numberFormat = new Intl.NumberFormat(locale.baseName)

const memoryUnits = [
  'byte',
  'kilobyte',
  'megabyte',
  'gigabyte',
  'terabyte',
  'petabyte',
] as const

const memoryFormatters = memoryUnits.map((unit, index) =>
  new Intl.NumberFormat(locale.baseName, {
    maximumFractionDigits: index >= 3 ? 2 : 0,
    style: 'unit',
    unit,
  }),
)

const speedFormatters = {
  KBps: new Intl.NumberFormat(locale.baseName, {
    maximumFractionDigits: 2,
    style: 'unit',
    unit: 'kilobyte-per-second',
  }),
  MBps: new Intl.NumberFormat(locale.baseName, {
    maximumFractionDigits: 2,
    style: 'unit',
    unit: 'megabyte-per-second',
  }),
  GBps: new Intl.NumberFormat(locale.baseName, {
    maximumFractionDigits: 2,
    style: 'unit',
    unit: 'gigabyte-per-second',
  }),
}

const kilo = 1000

function pluralize(one: string, many: string, count: number) {
  return pluralRules.select(count) === 'one' ? one : many
}

export function formatNumber(value: number) {
  return numberFormat.format(value)
}

export function formatBytes(bytes: number) {
  if (bytes < 0) return 'Unknown'
  if (bytes === 0) return 'None'

  let size = bytes
  for (const formatter of memoryFormatters) {
    if (size < kilo) {
      return formatter.format(size)
    }
    size /= kilo
  }

  return 'E2BIG'
}

export function formatRatio(value: number) {
  if (value === -1) return 'None'
  if (value === -2) return 'Infinity'

  const rounded = Math.floor(value * 10) / 10
  return rounded.toFixed(rounded < 100 ? 1 : 0)
}

export function formatPercent(value: number, maximumFractionDigits = 1) {
  const rounded = Math.floor(value * 10 ** maximumFractionDigits) / 10 ** maximumFractionDigits
  return rounded.toFixed(value < 100 ? maximumFractionDigits : 0)
}

export function formatSpeedBps(bytesPerSecond: number) {
  const kiloBytesPerSecond = Math.floor(bytesPerSecond / kilo)

  if (kiloBytesPerSecond < 999.95) {
    return speedFormatters.KBps.format(kiloBytesPerSecond)
  }
  if (kiloBytesPerSecond < 999_950) {
    return speedFormatters.MBps.format(kiloBytesPerSecond / 1000)
  }

  return speedFormatters.GBps.format(kiloBytesPerSecond / 1_000_000)
}

export function formatDuration(seconds: number, depth = 2) {
  if (seconds < 0) return 'Unknown'

  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const wholeSeconds = Math.floor(seconds % 60)

  const parts: string[] = []
  if (days) parts.push(`${formatNumber(days)} ${pluralize('day', 'days', days)}`)
  if (days || hours) parts.push(`${formatNumber(hours)} ${pluralize('hour', 'hours', hours)}`)
  if (days || hours || minutes) {
    parts.push(`${formatNumber(minutes)} ${pluralize('minute', 'minutes', minutes)}`)
    return parts.slice(0, depth).join(', ')
  }

  return `${formatNumber(wholeSeconds)} ${pluralize('second', 'seconds', wholeSeconds)}`
}

export function formatTimestamp(unixSeconds?: number) {
  if (!unixSeconds) return 'N/A'

  return new Intl.DateTimeFormat(locale.baseName, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(unixSeconds * 1000))
}

export function formatCompact(value: number) {
  return new Intl.NumberFormat(locale.baseName, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}
