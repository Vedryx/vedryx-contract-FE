import { useEffect, useRef } from 'react'

export function HeroScene() {
  const mountRef = useRef(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return undefined
    let cleanupScene = null
    let cancelled = false

    async function setupScene() {
      const { THREE, disposeScene, makeGlowTexture } = await import('../../../utils/threeScene.js')

      if (cancelled || !mount.isConnected) return

      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const scene = new THREE.Scene()
      scene.fog = new THREE.FogExp2(0x05060c, 0.016)

      const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 120)
      camera.position.set(0, 3.4, 20)
      camera.lookAt(0, -1, 0)

      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      })
      renderer.setClearColor(0x000000, 0)
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
        time += reduced ? 0 : 0.004
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
        if (visible && !reduced) start()
      }

      function start() {
        if (frame || reduced) return
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
      if (!reduced)
        window.addEventListener('pointermove', onPointerMove, {
          passive: true,
        })

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
      if (!reduced) start()

      cleanupScene = () => {
        stop()
        observer.disconnect()
        window.removeEventListener('resize', resize)
        if (!reduced) window.removeEventListener('pointermove', onPointerMove)
        if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
        disposeScene(scene)
        glow.dispose()
        renderer.dispose()
      }
    }

    setupScene()

    return () => {
      cancelled = true
      cleanupScene?.()
    }
  }, [])

  return <div id="scene" ref={mountRef} />
}
