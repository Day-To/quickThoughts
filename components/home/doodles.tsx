const YELLOW = "#ffd766"
const CORAL = "#ffb3a6"
const SKY = "#b5dcff"
const LILAC = "#d9c8ff"
const MINT = "#bfeed6"

type Doodle = {
  name: string
  size: number
  rotate: number
  /** Where it sits, as CSS insets, so doodles stay in the margins beside the composer. */
  place: React.CSSProperties
  /** Size and position on phones; doodles without one are left out there. */
  phone?: { size: number; place: React.CSSProperties }
  art: React.ReactNode
}

/* Every doodle is drawn on a 100 x 100 grid with the same pen: round, 3 units thick. */
const DOODLES: Doodle[] = [
  {
    name: "lightbulb",
    size: 132,
    rotate: -10,
    place: { top: "13%", left: "7%" },
    phone: { size: 44, place: { top: 58, right: 16 } },
    art: (
      <>
        <path
          fill={YELLOW}
          d="M50 16c-15 0-26 11-26 25 0 9 4 16 10 21 3 3 5 6 5 10h22c0-4 2-7 5-10 6-5 10-12 10-21 0-14-11-25-26-25z"
        />
        <path d="M41 80h18M44 88h12M43 44l7 8 7-8M50 52v20" />
        <path d="M50 4v5M18 14l4 4M82 14l-4 4M8 42h5M87 42h5" />
      </>
    ),
  },
  {
    name: "sparkle",
    size: 46,
    rotate: 8,
    place: { top: "33%", left: "21%" },
    art: (
      <path
        fill={CORAL}
        d="M50 8c4 27 15 38 42 42-27 4-38 15-42 42-4-27-15-38-42-42 27-4 38-15 42-42z"
      />
    ),
  },
  {
    name: "pencil",
    size: 118,
    rotate: 0,
    place: { top: "47%", left: "11%" },
    art: (
      <g transform="rotate(38 50 50)">
        <path fill={SKY} d="M41 12h18v54H41z" />
        <path fill="#fff" d="M41 66h18l-9 22z" />
        <path fill={CORAL} d="M41 12h18v10H41z" />
        <path d="M41 22h18M50 12v0M46 80l4 8 4-8" />
      </g>
    ),
  },
  {
    name: "thought cloud",
    size: 150,
    rotate: 4,
    place: { bottom: "17%", left: "4%" },
    art: (
      <>
        <path
          fill="#fff"
          d="M30 60c-10 0-17-6-17-14s7-14 15-13c2-10 11-17 22-17 10 0 18 5 21 13 9 0 16 7 16 16s-7 15-16 15z"
        />
        <circle fill="#fff" cx="24" cy="76" r="5.5" />
        <circle fill="#fff" cx="13" cy="89" r="3.2" />
        <path d="M40 40h22M36 49h30" />
      </>
    ),
  },
  {
    name: "squiggle",
    size: 120,
    rotate: -6,
    place: { bottom: "6%", left: "22%" },
    phone: { size: 84, place: { bottom: "3%", left: "8%" } },
    art: <path d="M6 50q11-22 22 0t22 0 22 0 22 0" />,
  },
  {
    name: "paper plane",
    size: 138,
    rotate: 6,
    place: { top: "11%", right: "8%" },
    phone: { size: 92, place: { bottom: "5%", right: "7%" } },
    art: (
      <>
        <path fill={MINT} d="M10 46l80-34-26 76-16-30z" />
        <path d="M48 58l42-46M48 58l2 20 10-12" />
        <path strokeDasharray="1 9" d="M6 70c8 10 20 14 32 10" />
      </>
    ),
  },
  {
    name: "star",
    size: 54,
    rotate: -12,
    place: { top: "35%", right: "5%" },
    phone: { size: 34, place: { bottom: "17%", left: "22%" } },
    art: (
      <path
        fill={YELLOW}
        d="M50 8l12 27 30 3-23 20 7 30-26-16-26 16 7-30L8 38l30-3z"
      />
    ),
  },
  {
    name: "microphone",
    size: 112,
    rotate: 12,
    place: { top: "45%", right: "15%" },
    art: (
      <>
        <rect fill={LILAC} x="37" y="10" width="26" height="46" rx="13" />
        <path d="M24 44c0 15 11 26 26 26s26-11 26-26M50 70v18M36 88h28M45 24h10M45 33h10" />
      </>
    ),
  },
  {
    name: "photo",
    size: 140,
    rotate: -7,
    place: { bottom: "19%", right: "5%" },
    art: (
      <>
        <rect fill="#fff" x="12" y="22" width="76" height="58" rx="7" />
        <path fill={MINT} d="M19 72l19-24 13 14 9-9 19 19z" />
        <circle fill={YELLOW} cx="66" cy="39" r="6.5" />
        <path d="M12 72h76" />
      </>
    ),
  },
  {
    name: "coffee",
    size: 112,
    rotate: 5,
    place: { bottom: "4%", right: "23%" },
    art: (
      <>
        <path fill={CORAL} d="M20 42h48v20c0 13-10 22-24 22s-24-9-24-22z" />
        <path d="M68 48c14 0 15 20 0 20M36 32c-5-7 5-9 0-17M52 32c-5-7 5-9 0-17M12 90h64" />
      </>
    ),
  },
]

/** Cartoon doodles scattered in the margins of the home screen. Purely decorative. */
export function Doodles() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden text-foreground/45 dark:text-foreground/40"
    >
      {DOODLES.map(({ name, size, rotate, place, phone, art }) => (
        <span key={name}>
          <Drawing size={size} rotate={rotate} place={place} className="max-lg:hidden">
            {art}
          </Drawing>
          {phone && (
            <Drawing size={phone.size} rotate={rotate} place={phone.place} className="sm:hidden">
              {art}
            </Drawing>
          )}
        </span>
      ))}
    </div>
  )
}

function Drawing({
  size,
  rotate,
  place,
  className,
  children,
}: {
  size: number
  rotate: number
  place: React.CSSProperties
  className: string
  children: React.ReactNode
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`doodle absolute ${className}`}
      style={{ ...place, rotate: `${rotate}deg` }}
    >
      {children}
    </svg>
  )
}
