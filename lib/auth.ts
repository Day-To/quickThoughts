"use client"

import type { Session } from "@supabase/supabase-js"
import { create } from "zustand"
import { supabase } from "./supabase"

type AuthState = {
  /** Null when signed out. The app is only usable signed in. */
  session: Session | null
  /** False until the saved session (if any) has been read from this browser. */
  ready: boolean
  /** True after arriving from a password-reset email, until a new password is saved. */
  recovering: boolean
}

export const useAuth = create<AuthState>(() => ({ session: null, ready: false, recovering: false }))

/** Starts tracking the session. Call once, in the browser. Returns a function that stops it. */
export function watchSession(): () => void {
  const { data } = supabase().auth.onAuthStateChange((event, session) => {
    useAuth.setState((state) => ({
      session,
      ready: true,
      recovering: event === "PASSWORD_RECOVERY" ? true : session ? state.recovering : false,
    }))
  })
  return () => data.subscription.unsubscribe()
}

/** Each of these resolves to null on success, or a message to show the user. */
type Outcome = Promise<string | null>

export async function signIn(email: string, password: string): Outcome {
  const { error } = await supabase().auth.signInWithPassword({ email, password })
  return error ? friendly(error.message) : null
}

/**
 * Creates an account. Supabase emails a confirmation link; the account can sign in
 * once it has been opened. Resolves to "confirm" in that case, or "signed-in" when
 * the project doesn't require confirmation.
 */
export async function signUp(
  email: string,
  password: string
): Promise<{ error: string } | { result: "confirm" | "signed-in" }> {
  const { data, error } = await supabase().auth.signUp({
    email,
    password,
    options: { emailRedirectTo: window.location.origin },
  })
  if (error) return { error: friendly(error.message) }
  return { result: data.session ? "signed-in" : "confirm" }
}

/** Emails a link that signs the user in without a password. */
export async function requestSignInLink(email: string): Outcome {
  const { error } = await supabase().auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin, shouldCreateUser: false },
  })
  return error ? friendly(error.message) : null
}

/** Emails a link that brings the user back here to choose a new password. */
export async function requestPasswordReset(email: string): Outcome {
  const { error } = await supabase().auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  })
  return error ? friendly(error.message) : null
}

export async function setNewPassword(password: string): Outcome {
  const { error } = await supabase().auth.updateUser({ password })
  if (error) return friendly(error.message)
  useAuth.setState({ recovering: false })
  return null
}

function friendly(message: string): string {
  if (/invalid login credentials/i.test(message)) return "That email or password isn't right."
  if (/email not confirmed/i.test(message)) return "Confirm your email first: open the link we sent when you created the account."
  if (/already registered|already exists/i.test(message)) return "An account with this email already exists. Sign in instead."
  if (/rate limit|too many/i.test(message)) return "Too many attempts. Wait a little while and try again."
  if (/signups? not allowed|not found/i.test(message)) return "There's no account with that email."
  if (/different from the old/i.test(message)) return "Choose a password you haven't used here before."
  if (/failed to fetch|network/i.test(message)) return "Can't reach the server. Check your connection and try again."
  return message
}
