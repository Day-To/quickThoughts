"use client"

import { useState } from "react"
import { Clock, MapPin, Search, ShieldCheck } from "lucide-react"
import { refreshPosition } from "@/lib/context"
import { useNotes } from "@/lib/store"
import { Button } from "@/components/ui/button"
import { Doodles } from "@/components/home/doodles"

const REASONS: [icon: React.ReactNode, title: string, detail: string][] = [
  [<Search key="find" />, "Find thoughts by place", "Search for what you noted \"at the pharmacy\" or \"in Goa\" later on."],
  [<Clock key="context" />, "Remember the moment", "Each thought keeps where you were along with the day and time."],
  [<ShieldCheck key="private" />, "Only yours", "It is saved with your own notes, rounded to about 10 metres, and only when you capture a thought. You can switch it off any time from the account menu."],
]

/** Shown once after signing in on a device: why location is collected, and the choice to allow it. */
export function LocationStep() {
  const answerLocation = useNotes((s) => s.answerLocation)
  const [asking, setAsking] = useState(false)
  const [refused, setRefused] = useState(false)

  const enable = async () => {
    setAsking(true)
    // The browser shows its own permission prompt here.
    const granted = await refreshPosition()
    setAsking(false)
    if (granted) answerLocation(true)
    else setRefused(true)
  }

  return (
    <div className="relative grid h-full w-full place-items-center overflow-y-auto bg-background px-4 py-10">
      <Doodles />
      <div className="relative w-full max-w-[400px] rounded-[22px] bg-card p-6 shadow-[0_0_0_0.5px_rgb(0_0_0/0.08),0_2px_6px_rgb(0_0_0/0.04),0_14px_40px_rgb(0_0_0/0.08)] dark:shadow-[inset_0_0.5px_0_rgb(255_255_255/0.12),0_14px_40px_rgb(0_0_0/0.5)]">
        <span className="grid size-12 place-items-center rounded-2xl bg-app-accent/15">
          <MapPin className="size-6 text-app-accent" strokeWidth={1.8} />
        </span>
        <h1 className="pt-4 text-[22px] leading-tight font-bold">Add location to your thoughts</h1>
        <p className="pt-1.5 text-[14px] leading-snug text-muted-foreground">
          Quick Thoughts can save where you were when you captured each thought.
        </p>
        <ul className="grid gap-3.5 py-5">
          {REASONS.map(([icon, title, detail]) => (
            <li key={title} className="flex gap-3">
              <span className="mt-0.5 shrink-0 text-app-accent [&_svg]:size-[18px] [&_svg]:[stroke-width:1.8]">{icon}</span>
              <div>
                <div className="text-[14px] font-semibold">{title}</div>
                <div className="text-[13px] leading-snug text-muted-foreground">{detail}</div>
              </div>
            </li>
          ))}
        </ul>
        {refused && (
          <p role="alert" className="pb-3 text-[13px] leading-snug text-destructive">
            Your browser didn&apos;t allow location. Allow it for this site in the browser&apos;s settings and try again, or continue without it.
          </p>
        )}
        <div className="grid gap-2">
          <Button size="lg" disabled={asking} onClick={enable}>
            {asking ? "Waiting for your browser…" : refused ? "Try Again" : "Turn On Location"}
          </Button>
          <Button size="lg" variant="ghost" disabled={asking} onClick={() => answerLocation(false)}>
            {refused ? "Continue Without Location" : "Not Now"}
          </Button>
        </div>
      </div>
    </div>
  )
}
