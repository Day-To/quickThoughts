import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

/** Floating glass capsule that holds one toolbar button, or a `group` of them. */
export function Pill({
  group,
  className,
  ...props
}: React.ComponentProps<"div"> & { group?: boolean }) {
  return (
    <div
      className={cn(
        "glass flex h-9 shrink-0 items-center rounded-full pointer-coarse:h-10",
        group && "gap-0.5 px-1",
        className
      )}
      {...props}
    />
  )
}

export function ToolButton({
  label,
  active,
  className,
  ...props
}: React.ComponentProps<typeof Button> & { label: string; active?: boolean }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      title={label}
      aria-label={label}
      className={cn(
        "size-9 rounded-full text-foreground/75 pointer-coarse:size-10 transition-[background-color,color,scale,opacity] duration-150 ease-out",
        "hover:bg-foreground/[0.06] active:scale-90 active:not-aria-[haspopup]:translate-y-0 aria-expanded:bg-foreground/[0.08] dark:hover:bg-foreground/10",
        "[&_svg]:[stroke-width:1.75] [&_svg:not([class*='size-'])]:size-[18px]",
        active && "bg-foreground/[0.08] text-app-accent",
        className
      )}
      {...props}
    />
  )
}
