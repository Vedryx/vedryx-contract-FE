import { useEffect, useRef, useState } from 'react'
import { isWebglAvailable, reportWebglUnavailable } from '../../../utils/webglSupport.js'

/**
 * Defer Three.js init until the browser is idle.
 *
 * Why: Three.js bundles (~525KB raw / ~140KB gz) were evaluating on the
 * critical path on mobile, blocking the main thread for ~7.5s and pushing
 * LCP to 5.7s on Moto-G4-class hardware. Desktop perf was already fine.
 *
 * Strategy:
 *   1. Render a CSS-only static fallback synchronously so the hero is
 *      painted before any JS evaluation (the SSR/prerender step ships this
 *      markup, so it shows up in the HTML response too — no flash).
 *   2. On the client, if the user prefers reduced motion, skip Three.js
 *      entirely and leave the static fallback in place permanently.
 *   3. Feature-detect WebGL via `webglSupport.isWebglAvailable()`. If the
 *      browser cannot give us a WebGL context (Edge/Windows users with
 *      unidentified GPUs, RDP/Citrix sessions, hardware accel disabled —
 *      Sentry issue VEDRYX-CORE-WEB-2), skip Three.js entirely and leave
 *      the static fallback in place permanently. Same behavior as
 *      reduced-motion.
 *   4. Otherwise, schedule the dynamic-import + scene setup via
 *      `requestIdleCallback` (timeout 2000ms) so it runs after LCP fires.
 *      Safari/iOS (which still don't ship RIC as of mid-2026) fall back to
 *      `setTimeout(..., 0)` — runs after the current task, post first paint.
 *   5. The WebGLRenderer constructor is wrapped in try/catch. Detection can
 *      pass while construction still fails on a small subset of drivers;
 *      that path also collapses to the static fallback and breadcrumbs to
 *      Sentry at INFO level (not error — user environment, not our bug).
 *   6. Once the canvas is mounted, fade out the static fallback. No layout
 *      shift because both share the same absolutely-positioned wrapper.
 */
export function HeroScene() {
  const mountRef = useRef(null)
  const [canvasReady, setCanvasReady] = useState(false)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return undefined

    // If the user prefers reduced motion, do NOT load Three.js at all.
    // The static fallback remains visible permanently — no JS cost, no
    // animation, fully accessible.
    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (reduced) return undefined

    // WebGL feature-detect. On Edge/Windows users with unidentified GPUs
    // (VENDOR/DEVICE = 0xffff), RDP sessions, or disabled hardware accel,
    // the browser refuses to give us a WebGL context. Skip Three.js entirely
    // — the static fallback is the experience. Soft-breadcrumb to Sentry at
    // INFO level so we can size the affected population without paging.
    if (!isWebglAvailable()) {
      reportWebglUnavailable('feature-detect-failed', { surface: 'hero' })
      return undefined
    }

    let cleanupScene = null
    let cancelled = false
    let idleHandle = null
    let timeoutHandle = null

    async function setupScene() {
      if (cancelled || !mount.isConnected) return

      const { THREE, disposeScene, makeGlowTexture } = await import('../../../utils/threeScene.js')

      if (cancelled || !mount.isConnected) return

      const scene = new THREE.Scene()
      scene.fog = new THREE.FogExp2(0x05060c, 0.016)

      const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 120)
      camera.position.set(0, 3.4, 20)
      camera.lookAt(0, -1, 0)

      // Driver-level failures can still throw here even after a passing
      // feature detect (sandboxed iframes, broken integrated GPUs, etc.).
      // Catch, breadcrumb, leave the static fallback in place. No retry.
      let renderer
      try {
        renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: true,
          powerPreference: 'high-performance',
        })
      } catch (err) {
        reportWebglUnavailable('renderer-construct-threw', {
          surface: 'hero',
          message: err?.message,
        })
        return
      }
      renderer.setClearColor(0x000000, 0)
      renderer.domElement.className = 'scene-canvas'
      mount.appendChild(renderer.domElement)

      const glow = makeGlowTexture()
      const world = new THREE.Group()
      scene.add(world)

      const grid = new THREE.GridHelper(140, 70, 0x46d9ff, 0x2a3a7a)
      grid.material.transparent = true
      grid.material.opacity = 0.22
      grid.material.blending = THREE.AdditiveBlending
      grid.position.y = -8
      scene.add(grid)

      const core = new THREE.Group()
      world.add(core)
      const icoA = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(3.4, 1)),
        new THREE.LineBasicMaterial({
          color: 0x6d8bff,
          transparent: true,
          opacity: 0.55,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      )
      const icoB = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(2, 0)),
        new THREE.LineBasicMaterial({
          color: 0x46d9ff,
          transparent: true,
          opacity: 0.5,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      )
      const coreGlow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glow,
          color: 0xaebfff,
          transparent: true,
          blending: THREE.AdditiveBlending,
          opacity: 0.85,
          depthWrite: false,
        }),
      )
      coreGlow.scale.set(9, 9, 1)
      core.add(icoA, icoB, coreGlow)

      function getSceneProfile() {
        const width = window.innerWidth
        if (width <= 560)
          return {
            count: 38,
            nodeSpreadX: 24,
            nodeOffsetX: -7,
            coreVisible: false,
            coreX: 13,
            coreY: 1.2,
            coreScale: 0.72,
          }
        if (width <= 980)
          return {
            count: 76,
            nodeSpreadX: 28,
            nodeOffsetX: -5,
            coreVisible: true,
            coreX: 11.2,
            coreY: 0.8,
            coreScale: 0.72,
          }
        return {
          count: 116,
          nodeSpreadX: 30,
          nodeOffsetX: -3,
          coreVisible: true,
          coreX: 8.6,
          coreY: 1.4,
          coreScale: 1,
        }
      }

      const sceneProfile = getSceneProfile()
      core.position.set(sceneProfile.coreX, sceneProfile.coreY, 0)
      core.scale.setScalar(sceneProfile.coreScale)
      core.visible = sceneProfile.coreVisible

      const count = sceneProfile.count
      const nodes = []
      const seeds = []
      const positions = new Float32Array(count * 3)
      for (let index = 0; index < count; index += 1) {
        const node = new THREE.Vector3((Math.random() - 0.5) * sceneProfile.nodeSpreadX + sceneProfile.nodeOffsetX, (Math.random() - 0.5) * 15, (Math.random() - 0.5) * 21)
        nodes.push(node)
        seeds.push({
          x: Math.random() * 6.28,
          y: Math.random() * 6.28,
          z: Math.random() * 6.28,
          s: 0.2 + Math.random() * 0.5,
          base: node.clone(),
        })
        positions[index * 3] = node.x
        positions[index * 3 + 1] = node.y
        positions[index * 3 + 2] = node.z
      }

      const pointGeometry = new THREE.BufferGeometry()
      pointGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      const points = new THREE.Points(
        pointGeometry,
        new THREE.PointsMaterial({
          size: 0.58,
          map: glow,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          color: 0xaebfff,
          opacity: 0.82,
        }),
      )
      world.add(points)

      const maxSegments = count * 7
      const lineGeometry = new THREE.BufferGeometry()
      lineGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxSegments * 6), 3))
      lineGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(maxSegments * 6), 3))
      const lines = new THREE.LineSegments(
        lineGeometry,
        new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.28,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      )
      world.add(lines)

      const target = { x: 0, y: 0 }
      const current = { x: 0, y: 0 }
      const colorA = new THREE.Color(0x6d8bff)
      const colorB = new THREE.Color(0x46d9ff)
      let time = 0
      let frame = 0
      let visible = true

      function rebuildEdges() {
        const position = lineGeometry.attributes.position.array
        const color = lineGeometry.attributes.color.array
        let segmentIndex = 0
        for (let i = 0; i < count; i += 1) {
          for (let j = i + 1; j < count; j += 1) {
            const a = nodes[i]
            const b = nodes[j]
            const distance = a.distanceTo(b)
            if (distance < 5 && segmentIndex < maxSegments) {
              const strength = 1 - distance / 5
              const offset = segmentIndex * 6
              position[offset] = a.x
              position[offset + 1] = a.y
              position[offset + 2] = a.z
              position[offset + 3] = b.x
              position[offset + 4] = b.y
              position[offset + 5] = b.z
              color[offset] = colorA.r * strength
              color[offset + 1] = colorA.g * strength
              color[offset + 2] = colorA.b * strength
              color[offset + 3] = colorB.r * strength
              color[offset + 4] = colorB.g * strength
              color[offset + 5] = colorB.b * strength
              segmentIndex += 1
            }
          }
        }
        lineGeometry.setDrawRange(0, segmentIndex * 2)
        lineGeometry.attributes.position.needsUpdate = true
        lineGeometry.attributes.color.needsUpdate = true
      }

      function resize() {
        const width = mount.clientWidth
        const height = mount.clientHeight
        const profile = getSceneProfile()
        core.position.set(profile.coreX, profile.coreY, 0)
        core.scale.setScalar(profile.coreScale)
        core.visible = profile.coreVisible
        renderer.setSize(width, height)
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        camera.aspect = width / height
        camera.updateProjectionMatrix()
      }

      function onPointerMove(event) {
        target.x = event.clientX / window.innerWidth - 0.5
        target.y = event.clientY / window.innerHeight - 0.5
      }

      function renderFrame(animate = true) {
        time += 0.004
        const array = pointGeometry.attributes.position.array
        for (let index = 0; index < count; index += 1) {
          const seed = seeds[index]
          const base = seed.base
          const node = nodes[index]
          node.set(base.x + Math.sin(time * seed.s + seed.x) * 0.8, base.y + Math.cos(time * seed.s + seed.y) * 0.8, base.z + Math.sin(time * seed.s + seed.z) * 0.8)
          array[index * 3] = node.x
          array[index * 3 + 1] = node.y
          array[index * 3 + 2] = node.z
        }
        pointGeometry.attributes.position.needsUpdate = true
        rebuildEdges()
        if (core.visible) {
          icoA.rotation.y += 0.0024
          icoA.rotation.x += 0.0011
          icoB.rotation.y -= 0.004
          icoB.rotation.z += 0.002
          coreGlow.material.opacity = 0.85 + Math.sin(time * 2.2) * 0.12
        }
        current.x += (target.x - current.x) * 0.04
        current.y += (target.y - current.y) * 0.04
        world.rotation.y = current.x * 0.45 + time * 0.035
        world.rotation.x = current.y * 0.25
        renderer.render(scene, camera)
        return animate
      }

      function tick() {
        frame = 0
        renderFrame()
        if (visible) start()
      }

      function start() {
        if (frame) return
        frame = requestAnimationFrame(tick)
      }

      function stop() {
        if (!frame) return
        cancelAnimationFrame(frame)
        frame = 0
      }

      resize()
      renderFrame(false)
      window.addEventListener('resize', resize)
      window.addEventListener('pointermove', onPointerMove, { passive: true })

      const observer = new IntersectionObserver(
        (entries) => {
          visible = entries.some((entry) => entry.isIntersecting)
          if (visible) {
            start()
          } else {
            stop()
          }
        },
        {
          root: null,
          rootMargin: '160px 0px',
          threshold: 0.01,
        },
      )

      observer.observe(mount)
      start()

      // Flip the canvas-ready flag so the static fallback fades out.
      // Done after first render so we never have a blank frame.
      if (!cancelled) setCanvasReady(true)

      cleanupScene = () => {
        stop()
        observer.disconnect()
        window.removeEventListener('resize', resize)
        window.removeEventListener('pointermove', onPointerMove)
        if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
        disposeScene(scene)
        glow.dispose()
        renderer.dispose()
      }
    }

    // Schedule init for browser idle time. `requestIdleCallback` lets the
    // browser paint LCP first, then run our setup when the main thread is
    // free. Safari/iOS still don't ship it (as of mid-2026), so fall back
    // to `setTimeout(..., 0)` — runs after the current task / first paint.
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      idleHandle = window.requestIdleCallback(() => setupScene(), { timeout: 2000 })
    } else {
      timeoutHandle = setTimeout(() => setupScene(), 0)
    }

    return () => {
      cancelled = true
      if (idleHandle != null && typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleHandle)
      }
      if (timeoutHandle != null) clearTimeout(timeoutHandle)
      cleanupScene?.()
    }
  }, [])

  return (
    <div id="scene" ref={mountRef} aria-hidden="true">
      <div className={`scene-fallback${canvasReady ? ' is-hidden' : ''}`} />
    </div>
  )
}
