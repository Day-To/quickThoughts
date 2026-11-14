const DAY = 86_400_000

function daysAgo(ts: number): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const then = new Date(ts)
  then.setHours(0, 0, 0, 0)
  return Math.round((today.getTime() - then.getTime()) / DAY)
}

const time = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })

/** Section heading in the note list: Today, Yesterday, Previous 7 Days, month, year. */
export function groupLabel(ts: number): string {
  const days = daysAgo(ts)
  if (days <= 0) return "Today"
  if (days === 1) return "Yesterday"
  if (days <= 7) return "Previous 7 Days"
  if (days <= 30) return "Previous 30 Days"
  const date = new Date(ts)
  if (date.getFullYear() === new Date().getFullYear()) {
    return date.toLocaleDateString([], { month: "long" })
  }
  return String(date.getFullYear())
}

/** Compact date shown on a note row. */
export function listDate(ts: number): string {
  const days = daysAgo(ts)
  if (days <= 0) return time(ts)
  if (days === 1) return "Yesterday"
  if (days < 7) return new Date(ts).toLocaleDateString([], { weekday: "long" })
  return new Date(ts).toLocaleDateString([], {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  })
}

/** Heading on the home screen, e.g. "Saturday, 14 November". */
export function todayLabel(): string {
  return new Date().toLocaleDateString([], {
    weekday: "long",
    day: "numeric",
    month: "long",
  })
}

/** Date line at the top of the editor. */
export function fullDate(ts: number): string {
  const date = new Date(ts).toLocaleDateString([], {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
  return `${date} at ${time(ts)}`
}
