"use client"

import { useState } from "react"
import { Eye, EyeOff, Lightbulb, MailCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  requestPasswordReset,
  requestSignInLink,
  setNewPassword,
  signIn,
  signUp,
  useAuth,
} from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Doodles } from "@/components/home/doodles"

const MIN_PASSWORD = 8

type Mode = "sign-in" | "sign-up" | "forgot"
/** A confirmation shown in place of the form after an email has been sent. */
type Sent = { title: string; body: string }

/** The only screen available until someone is signed in. */
export function AuthScreen() {
  const recovering = useAuth((s) => s.recovering)

  return (
    <div className="relative grid h-full w-full place-items-center overflow-y-auto bg-background px-4 pt-[max(2.5rem,calc(env(safe-area-inset-top)+1rem))] pb-10">
      <Doodles />
      <div className="relative w-full max-w-[380px]">
        <div className="flex flex-col items-center pb-6 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-app-accent/15">
            <Lightbulb className="size-7 text-app-accent" strokeWidth={1.8} />
          </span>
          <h1 className="pt-4 text-[24px] leading-tight font-bold">Quick Thoughts</h1>
          <p className="pt-1.5 text-[14px] text-muted-foreground">
            Catch the thought now. Find it when you need it.
          </p>
        </div>
        <div className="rounded-[22px] bg-card p-6 shadow-[0_0_0_0.5px_rgb(0_0_0/0.08),0_2px_6px_rgb(0_0_0/0.04),0_14px_40px_rgb(0_0_0/0.08)] dark:shadow-[inset_0_0.5px_0_rgb(255_255_255/0.12),0_14px_40px_rgb(0_0_0/0.5)]">
          {recovering ? <NewPasswordForm /> : <SignInForm />}
        </div>
      </div>
    </div>
  )
}

function SignInForm() {
  const [mode, setMode] = useState<Mode>("sign-in")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState<"submit" | "link" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<Sent | null>(null)

  const address = email.trim().toLowerCase()
  const switchTo = (next: Mode) => {
    setMode(next)
    setError(null)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (mode === "sign-up" && password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters for your password.`)
      return
    }
    setBusy("submit")
    if (mode === "sign-in") {
      setError(await signIn(address, password))
    } else if (mode === "sign-up") {
      const outcome = await signUp(address, password)
      if ("error" in outcome) setError(outcome.error)
      else if (outcome.result === "confirm") {
        setSent({
          title: "Confirm your email",
          body: `We sent a link to ${address}. Open it on this device to finish creating your account.`,
        })
      }
    } else {
      const problem = await requestPasswordReset(address)
      if (problem) setError(problem)
      else {
        setSent({
          title: "Check your email",
          body: `If there's an account for ${address}, we've sent a link to choose a new password.`,
        })
      }
    }
    setBusy(null)
  }

  const sendLink = async () => {
    setError(null)
    if (!/^\S+@\S+\.\S+$/.test(address)) {
      setError("Enter your email address first.")
      return
    }
    setBusy("link")
    const problem = await requestSignInLink(address)
    setBusy(null)
    if (problem) setError(problem)
    else {
      setSent({
        title: "Check your email",
        body: `We sent a sign-in link to ${address}. Open it on this device and you'll be signed in.`,
      })
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col items-center text-center">
        <MailCheck className="size-9 text-app-accent" strokeWidth={1.6} />
        <h2 className="pt-3 text-[17px] font-semibold">{sent.title}</h2>
        <p className="pt-1.5 text-[14px] leading-relaxed text-muted-foreground">{sent.body}</p>
        <p className="pt-1.5 text-[13px] text-muted-foreground/80">It can take a minute to arrive.</p>
        <Button
          variant="outline"
          className="mt-5 h-10 w-full rounded-xl"
          onClick={() => {
            setSent(null)
            setPassword("")
            switchTo("sign-in")
          }}
        >
          Back to sign in
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} noValidate={false} className="grid gap-4">
      {mode === "forgot" ? (
        <div>
          <h2 className="text-[17px] font-semibold">Reset your password</h2>
          <p className="pt-1 text-[14px] text-muted-foreground">
            Enter your email and we&apos;ll send a link to choose a new one.
          </p>
        </div>
      ) : (
        <div role="tablist" aria-label="Sign in or create an account" className="grid grid-cols-2 rounded-xl bg-foreground/[0.06] p-1">
          {(
            [
              ["sign-in", "Sign in"],
              ["sign-up", "Create account"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => switchTo(value)}
              className={cn(
                "h-9 rounded-lg text-[14px] font-medium text-muted-foreground transition-colors duration-150",
                mode === value && "bg-card text-foreground shadow-sm"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <Field label="Email">
        <Input
          required
          type="email"
          name="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          placeholder="you@example.com"
          className="h-11 rounded-xl"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>

      {mode !== "forgot" && (
        <PasswordField
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
          hint={mode === "sign-up" ? `At least ${MIN_PASSWORD} characters.` : undefined}
          aside={
            mode === "sign-in" && (
              <button
                type="button"
                onClick={() => switchTo("forgot")}
                className="text-[13px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Forgot password?
              </button>
            )
          }
        />
      )}

      {error && (
        <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" disabled={busy !== null} className="h-11 rounded-xl text-[15px]">
        {busy === "submit"
          ? "One moment…"
          : mode === "sign-in"
            ? "Sign In"
            : mode === "sign-up"
              ? "Create Account"
              : "Send Reset Link"}
      </Button>

      {mode === "sign-in" && (
        <>
          <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={busy !== null}
            onClick={sendLink}
            className="h-11 rounded-xl text-[14px]"
          >
            {busy === "link" ? "Sending…" : "Email me a sign-in link"}
          </Button>
        </>
      )}

      {mode === "forgot" && (
        <button
          type="button"
          onClick={() => switchTo("sign-in")}
          className="text-center text-[13px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Back to sign in
        </button>
      )}
    </form>
  )
}

/** Shown after opening a password-reset link. */
function NewPasswordForm() {
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters for your password.`)
      return
    }
    setBusy(true)
    setError(await setNewPassword(password))
    setBusy(false)
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div>
        <h2 className="text-[17px] font-semibold">Choose a new password</h2>
        <p className="pt-1 text-[14px] text-muted-foreground">You&apos;ll be signed in as soon as it&apos;s saved.</p>
      </div>
      <PasswordField
        label="New password"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        hint={`At least ${MIN_PASSWORD} characters.`}
      />
      {error && (
        <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy} className="h-11 rounded-xl text-[15px]">
        {busy ? "Saving…" : "Save Password"}
      </Button>
    </form>
  )
}

function Field({
  label,
  aside,
  hint,
  children,
}: {
  label: string
  aside?: React.ReactNode
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="grid gap-1.5">
      <span className="flex items-baseline justify-between text-[13px] font-medium">
        {label}
        {aside}
      </span>
      {children}
      {hint && <span className="text-[12px] text-muted-foreground">{hint}</span>}
    </label>
  )
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  hint,
  aside,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete: "current-password" | "new-password"
  hint?: string
  aside?: React.ReactNode
}) {
  const [visible, setVisible] = useState(false)
  return (
    <Field label={label} hint={hint} aside={aside}>
      <span className="relative">
        <Input
          required
          type={visible ? "text" : "password"}
          name="password"
          autoComplete={autoComplete}
          className="h-11 rounded-xl pr-11"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          aria-label={visible ? "Hide password" : "Show password"}
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted-foreground hover:text-foreground"
        >
          {visible ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
        </button>
      </span>
    </Field>
  )
}
