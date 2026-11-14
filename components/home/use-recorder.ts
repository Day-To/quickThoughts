"use client"

import { useEffect, useRef, useState } from "react"
import { blobToDataUrl } from "@/lib/media"

const BARS = 56

type Session = {
  recorder: MediaRecorder
  /** False when the recording is being discarded rather than kept. */
  keep: boolean
}

/** Records the microphone and reports a live level meter while doing so. */
export function useRecorder(onDone: (src: string, seconds: number) => void) {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [levels, setLevels] = useState<number[]>([])
  const [error, setError] = useState<string | null>(null)
  const session = useRef<Session | null>(null)

  const start = async () => {
    if (session.current) return
    setError(null)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setError("Allow microphone access to record a voice note.")
      return
    }

    // Speech doesn't need much; a low bitrate keeps recordings small enough to store inline.
    const recorder = new MediaRecorder(stream, { audioBitsPerSecond: 32_000 })
    const current: Session = { recorder, keep: true }
    session.current = current
    const chunks: Blob[] = []
    const startedAt = performance.now()

    const context = new AudioContext()
    const analyser = context.createAnalyser()
    analyser.fftSize = 256
    context.createMediaStreamSource(stream).connect(analyser)
    const samples = new Uint8Array(analyser.fftSize)
    let frame = 0
    let lastSample = 0
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      if (now - lastSample < 60) return
      lastSample = now
      analyser.getByteTimeDomainData(samples)
      let sum = 0
      for (const sample of samples) sum += ((sample - 128) / 128) ** 2
      const level = Math.min(1, Math.sqrt(sum / samples.length) * 5)
      setLevels((previous) => [...previous.slice(1 - BARS), level])
      setSeconds((performance.now() - startedAt) / 1000)
    }

    recorder.ondataavailable = (event) => chunks.push(event.data)
    recorder.onstop = async () => {
      cancelAnimationFrame(frame)
      stream.getTracks().forEach((track) => track.stop())
      void context.close()
      session.current = null
      setRecording(false)
      setLevels([])
      setSeconds(0)
      if (!current.keep) return
      const length = Math.max(1, (performance.now() - startedAt) / 1000)
      onDone(await blobToDataUrl(new Blob(chunks, { type: recorder.mimeType })), length)
    }

    recorder.start()
    frame = requestAnimationFrame(tick)
    setRecording(true)
  }

  const stop = (keep = true) => {
    const current = session.current
    if (!current) return
    current.keep = keep
    current.recorder.stop()
  }

  // Leaving the screen mid-recording releases the microphone.
  useEffect(
    () => () => {
      if (session.current) {
        session.current.keep = false
        session.current.recorder.stop()
      }
    },
    []
  )

  return { recording, seconds, levels, error, start, stop, bars: BARS }
}
