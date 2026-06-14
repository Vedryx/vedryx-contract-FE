// WebGL feature-detection + soft-failure helpers.
//
// Why this file exists
// --------------------
// Sentry issue VEDRYX-CORE-WEB-2 ("Error creating WebGL context") fired on
// Edge/Windows users whose GPU could not be identified by Chromium
// (VENDOR/DEVICE = 0xffff). Typical causes: remote desktop / RDP / Citrix
// sessions, VMs without 3D acceleration, integrated GPUs with broken
// drivers, or hardware acceleration disabled at the OS/browser level.
//
// These users physically cannot run WebGL. Three.js's WebGLRenderer
// constructor throws synchronously in that case, and the failure was
// uncaught — taking the entire landing page down via an unhandled promise
// rejection from the dynamic-import path that mounts the scene.
//
// The fix is twofold:
//   1. Before instantiating WebGLRenderer, run a cheap feature detect.
//      If the browser refuses to give us a `webgl2` or `webgl` context
//      from a throwaway canvas, skip Three.js entirely.
//   2. Wrap the WebGLRenderer constructor in a try/catch. Detection can
//      pass while construction still fails (driver-level edge cases,
//      sandboxed iframes, etc.). If construction throws, swallow the
//      error, breadcrumb it to Sentry at INFO level (not error — this is
//      user environment, not our bug), and let the caller paint the
//      static fallback.
//
// A session-scoped flag stops repeated retries inside the same tab: once
// we know WebGL is unavailable, React re-renders / route changes will not
// try again.

const SESSION_FLAG = '__vedryxWebglUnavailable'

/**
 * Mark this tab as WebGL-unavailable so subsequent mounts skip the
 * detection cost and go straight to the fallback.
 */
function markUnavailable() {
  if (typeof window !== 'undefined') {
    try {
      window[SESSION_FLAG] = true
    } catch {
      // Ignore — read-only globals only happen in synthetic test envs.
    }
  }
}

/**
 * Cheap, side-effect-free WebGL feature detect.
 *
 * Returns `true` if the browser can give us *any* WebGL context, `false`
 * if it cannot. Does not retain the test canvas. Idempotent and safe to
 * call on every mount.
 */
export function isWebglAvailable() {
  if (typeof window === 'undefined') return false
  if (window[SESSION_FLAG]) return false

  try {
    const canvas = document.createElement('canvas')
    const gl =
      canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl')
    if (!gl) {
      markUnavailable()
      return false
    }
    // Best-effort: release the throwaway context so the GC can reclaim it.
    const loseExt = gl.getExtension?.('WEBGL_lose_context')
    loseExt?.loseContext?.()
    return true
  } catch {
    markUnavailable()
    return false
  }
}

/**
 * Breadcrumb a WebGL-unavailable event to Sentry at INFO level.
 *
 * We deliberately use `captureMessage` at `info` instead of `captureException`
 * so this does not eat error-quota budget and does not page on a regressed
 * issue ticker. This is user environment context, not application error.
 *
 * No-ops cleanly if Sentry was never loaded (DSN unset in env).
 */
export async function reportWebglUnavailable(reason, extra = {}) {
  if (typeof window === 'undefined') return
  try {
    const Sentry = await import('@sentry/browser')
    Sentry.captureMessage('webgl-init-failed', {
      level: 'info',
      tags: { component: 'webgl', reason },
      extra: {
        userAgent: navigator?.userAgent,
        ...extra,
      },
    })
  } catch {
    // Sentry not loaded (no DSN) — nothing to report to. That's fine.
  }
}
