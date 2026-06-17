'use client'
// src/components/LiveCameraCapture.tsx
// Reusable live-camera capture for anti-fraud selfies. Opens the FRONT camera
// via getUserMedia, shows a live preview, and captures a single frame to a
// canvas which it hands back as a JPEG Blob (+ data URL) through onCapture.
//
// Deliberately FAIL-CLOSED: there is NO <input type=file> fallback, so a saved
// photo from the camera roll can never be substituted for a live frame. If the
// camera is unavailable (no secure context, no device, or permission denied)
// the component shows a blocking message and a retry — it never lets the caller
// proceed without a live capture.
//
// Self-contained (own styles, lc-* prefix) so the picker home (Phase 5) can
// reuse it as-is. The captured frame is NOT mirrored, so downstream face
// matching sees the true orientation.

import { useCallback, useEffect, useRef, useState } from 'react'

type Phase = 'init' | 'requesting' | 'ready' | 'denied' | 'unavailable'

export default function LiveCameraCapture({
  onCapture,
  busy = false,
  captureLabel = 'Capture',
  height = 300,
}: {
  // Called with the captured frame. The component stops the camera after
  // capture; the caller decides what to do next (upload, match, etc.).
  onCapture: (blob: Blob, dataUrl: string) => void
  // While the caller is processing the captured frame (e.g. uploading), pass
  // busy to disable the capture button.
  busy?: boolean
  captureLabel?: string
  height?: number
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [phase, setPhase] = useState<Phase>('init')
  const [detail, setDetail] = useState<string | null>(null)

  const stop = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  const start = useCallback(async () => {
    setDetail(null)
    // getUserMedia needs a secure context (https or localhost) and the API.
    if (typeof window === 'undefined' || !window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setPhase('unavailable')
      setDetail(
        typeof window !== 'undefined' && !window.isSecureContext
          ? 'The camera needs a secure (https) connection.'
          : 'This device or browser has no camera support.'
      )
      return
    }
    setPhase('requesting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
      setPhase('ready')
    } catch (err: any) {
      const name = err?.name ?? ''
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setPhase('denied')
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') {
        setPhase('unavailable')
        setDetail('No front camera was found on this device.')
      } else {
        setPhase('unavailable')
        setDetail('The camera could not be started. Close other apps using it and retry.')
      }
    }
  }, [])

  useEffect(() => {
    start()
    return stop
  }, [start, stop])

  function capture() {
    const video = videoRef.current
    if (!video || phase !== 'ready' || busy) return
    const w = video.videoWidth
    const h = video.videoHeight
    if (!w || !h) return
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, w, h) // raw (un-mirrored) frame
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
    canvas.toBlob(
      (blob) => {
        if (!blob) return
        stop() // release the camera once we have the frame
        onCapture(blob, dataUrl)
      },
      'image/jpeg',
      0.9
    )
  }

  return (
    <div className="lc-root">
      <style>{css(height)}</style>

      {(phase === 'init' || phase === 'requesting' || phase === 'ready') && (
        <div className="lc-stage">
          <video ref={videoRef} className="lc-video" autoPlay playsInline muted />
          {phase !== 'ready' && (
            <div className="lc-stage-overlay">
              <div className="lc-spinner" />
              <div className="lc-stage-msg">Starting camera…</div>
            </div>
          )}
        </div>
      )}

      {phase === 'denied' && (
        <div className="lc-block">
          <div className="lc-block-icon">📷</div>
          <div className="lc-block-title">Camera permission needed</div>
          <div className="lc-block-msg">Allow camera access in your browser, then retry. We don&apos;t store video — only a single photo at clock-in.</div>
        </div>
      )}

      {phase === 'unavailable' && (
        <div className="lc-block">
          <div className="lc-block-icon">🚫</div>
          <div className="lc-block-title">Camera required to clock in</div>
          <div className="lc-block-msg">{detail ?? 'A working camera is required.'}</div>
        </div>
      )}

      {phase === 'ready' ? (
        <button className="lc-btn primary" onClick={capture} disabled={busy}>
          {busy ? 'Working…' : captureLabel}
        </button>
      ) : phase === 'denied' || phase === 'unavailable' ? (
        <button className="lc-btn" onClick={start}>Try again</button>
      ) : (
        <button className="lc-btn" disabled>Starting…</button>
      )}
    </div>
  )
}

const TEAL = '#0F6E56'
const TEAL_MID = '#1D9E75'
const TEAL_LIGHT = '#E1F5EE'
const TEAL_DARK = '#085041'

function css(height: number) {
  return `
  .lc-root { width: 100%; max-width: 320px; display: flex; flex-direction: column; align-items: center; gap: 16px; }
  .lc-stage {
    width: 100%; height: ${height}px; border-radius: 18px; overflow: hidden; position: relative;
    background: #0b0b0b; border: 3px solid ${TEAL_MID};
  }
  .lc-video { width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1); } /* mirror preview only */
  .lc-stage-overlay {
    position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 14px; background: ${TEAL_LIGHT};
  }
  .lc-stage-msg { font-size: 13px; color: ${TEAL}; font-weight: 500; }
  .lc-spinner { width: 44px; height: 44px; border: 3px solid #fff; border-top-color: ${TEAL_MID}; border-radius: 50%; animation: lcspin 0.8s linear infinite; }
  @keyframes lcspin { to { transform: rotate(360deg); } }
  .lc-block {
    width: 100%; min-height: ${height}px; border-radius: 18px; border: 1px solid #F7C1C1; background: #FCEBEB;
    display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 28px 22px; gap: 8px;
  }
  .lc-block-icon { font-size: 40px; margin-bottom: 4px; }
  .lc-block-title { font-size: 17px; font-weight: 600; color: #791F1F; }
  .lc-block-msg { font-size: 13px; color: #963B3B; line-height: 1.5; max-width: 260px; }
  .lc-btn {
    width: 100%; padding: 18px; border-radius: 14px; border: none; background: #e5e7eb; color: ${TEAL_DARK};
    font-family: 'DM Sans', sans-serif; font-size: 16px; font-weight: 600; cursor: pointer; transition: transform 0.1s, opacity 0.1s;
  }
  .lc-btn.primary { background: ${TEAL_MID}; color: #fff; }
  .lc-btn:active { transform: scale(0.97); }
  .lc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  `
}
