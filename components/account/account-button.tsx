"use client"

import { useState } from "react"
import { useAuth } from "@/lib/auth"
import { refreshPosition } from "@/lib/context"
import { useNotes } from "@/lib/store"
import { signOutOfDevice, useSync } from "@/lib/sync"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Pill, ToolButton } from "@/components/notes/toolbar"

/** Who is signed in, sync status, the location setting, and sign out. */
export function AccountButton() {
  const session = useAuth((s) => s.session)
  const ready = useAuth((s) => s.ready)
  const sync = useSync((s) => s.status)
  const [blocked, setBlocked] = useState(false)
  const locationEnabled = useNotes((s) => s.locationEnabled)
  const setLocationEnabled = useNotes((s) => s.setLocationEnabled)
  const [locationRefused, setLocationRefused] = useState(false)

  if (ready && session) {
    const email = session.user.email ?? "Signed in"
    return (
      <Pill>
        <DropdownMenu>
          <DropdownMenuTrigger render={<ToolButton label="Account" />}>
            <span className="grid size-6 place-items-center rounded-full bg-app-accent text-[12px] font-bold text-white uppercase">
              {email[0]}
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="truncate">{email}</DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="font-normal text-muted-foreground">
                {blocked
                  ? "Couldn't sign out: some changes aren't saved to the cloud yet. Check your connection and try again."
                  : sync === "syncing"
                    ? "Syncing…"
                    : sync === "error"
                      ? "Can't reach the cloud. Changes are kept here and will sync when it's back."
                      : "All changes synced"}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={locationEnabled}
              closeOnClick={false}
              onCheckedChange={async (checked) => {
                setLocationRefused(false)
                if (!checked) return setLocationEnabled(false)
                // Only switch on if the browser actually grants access.
                const granted = await refreshPosition()
                setLocationEnabled(granted)
                setLocationRefused(!granted)
              }}
            >
              Add location to new thoughts
            </DropdownMenuCheckboxItem>
            {locationRefused && (
              <DropdownMenuGroup>
                <DropdownMenuLabel className="font-normal text-muted-foreground">
                  Location is blocked for this site. Allow it in your browser settings, then try again.
                </DropdownMenuLabel>
              </DropdownMenuGroup>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              closeOnClick={false}
              onClick={async () => setBlocked(!(await signOutOfDevice()))}
            >
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Pill>
    )
  }

  return null
}
