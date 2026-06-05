import { useEffect, useRef } from 'react'

function getSceneLayout(width) {
  if (width < 520) {
    return { cameraY: 8.7, cameraZ: 52, worldScaleX: 0.76, worldScaleY: 0.95, worldScaleZ: 1.12, labelScale: 1.08, pointerX: 0.16, pointerY: 0.08 }
  }

  if (width < 900) {
    return { cameraY: 9.5, cameraZ: 56, worldScale: 0.84, labelScale: 1.18, pointerX: 0.34, pointerY: 0.16 }
  }

  if (width < 1100) {
    return { cameraY: 9.5, cameraZ: 50, worldScale: 0.9, labelScale: 1, pointerX: 0.42, pointerY: 0.2 }
  }

  return { cameraY: 9, cameraZ: 42, worldScale: 1, labelScale: 1, pointerX: 0.5, pointerY: 0.22 }
}

export function TechUniverse() {
  const mountRef = useRef(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return undefined
    let cleanupScene = null
    let cancelled = false

    async function setupScene() {
      const { THREE, disposeScene, makeGlowTexture, makeLabelSprite } = await import('../../../utils/threeScene.js')

      if (cancelled || !mount.isConnected) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const scene = new THREE.Scene()
    scene.fog = new THREE.FogExp2(0x05060c, 0.012)
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200)
    camera.position.set(0, 9, 42)
    camera.lookAt(0, 0, 0)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    renderer.setClearColor(0x000000, 0)
    mount.appendChild(renderer.domElement)

    const glow = makeGlowTexture()
    const world = new THREE.Group()
    world.rotation.x = 0.34
    scene.add(world)

    const core = new THREE.Group()
    world.add(core)
    const coreA = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(4.6, 1)), new THREE.LineBasicMaterial({ color: 0x6d8bff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }))
    const coreB = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(2.7, 0)), new THREE.LineBasicMaterial({ color: 0x46d9ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }))
    const coreGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xaebfff, transparent: true, blending: THREE.AdditiveBlending, opacity: 0.9, depthWrite: false }))
    coreGlow.scale.set(15, 15, 1)
    core.add(coreA, coreB, coreGlow)

    const rings = [
      { r: 13, tilt: 0, dir: 1, speed: 0.085, itemScale: 1, items: ['Java', 'Spring Boot', 'JavaScript', 'React', 'Node.js'] },
      { r: 20, tilt: 0.5, dir: -1, speed: 0.06, itemScale: 1, items: ['Python', 'Flask', 'MongoDB', 'PostgreSQL', 'Redis', 'Kafka'] },
      { r: 27, tilt: -0.42, dir: 1, speed: 0.044, itemScale: 0.64, items: ['ELK Stack', 'Data Eng', 'Backend', 'Frontend', 'Full-stack', 'DevOps', 'QA'] },
    ].map((ring) => {
      const group = new THREE.Group()
      group.rotation.x = ring.tilt
      world.add(group)
      const segmentCount = 96
      const guidePositions = new Float32Array(segmentCount * 3)
      for (let index = 0; index < segmentCount; index += 1) {
        const angle = (index / segmentCount) * Math.PI * 2
        guidePositions[index * 3] = Math.cos(angle) * ring.r
        guidePositions[index * 3 + 2] = Math.sin(angle) * ring.r
      }
      const guideGeometry = new THREE.BufferGeometry()
      guideGeometry.setAttribute('position', new THREE.BufferAttribute(guidePositions, 3))
      const guide = new THREE.LineLoop(guideGeometry, new THREE.LineBasicMaterial({ color: 0x2a3a7a, transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending, depthWrite: false }))
      guide.renderOrder = 1
      group.add(guide)
      const labelObjects = []
      const labels = []
      const spokePositions = []
      ring.items.forEach((label, index) => {
        const angle = (index / ring.items.length) * Math.PI * 2
        const x = Math.cos(angle) * ring.r
        const z = Math.sin(angle) * ring.r
        const spokeStartRadius = 5.8
        const spokeEndRadius = ring.r * 0.54
        const sprite = makeLabelSprite(label)
        sprite.position.set(x, 0, z)
        sprite.scale.multiplyScalar(ring.itemScale)
        sprite.userData.baseScale = sprite.scale.clone()
        const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0x9db4ff, transparent: true, blending: THREE.AdditiveBlending, opacity: 0.9, depthWrite: false }))
        dot.scale.set(1.4, 1.4, 1)
        dot.position.set(x, 0, z)
        labelObjects.push(sprite, dot)
        labels.push(sprite)
        spokePositions.push(
          Math.cos(angle) * spokeStartRadius,
          0,
          Math.sin(angle) * spokeStartRadius,
          Math.cos(angle) * spokeEndRadius,
          0,
          Math.sin(angle) * spokeEndRadius,
        )
      })
      const spokeGeometry = new THREE.BufferGeometry()
      spokeGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(spokePositions), 3))
      const spokes = new THREE.LineSegments(spokeGeometry, new THREE.LineBasicMaterial({ color: 0x3a4a8a, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false }))
      spokes.renderOrder = 1
      group.add(spokes)
      labelObjects.forEach((object) => group.add(object))
      return { group, radius: ring.r, dir: ring.dir, speed: ring.speed * 0.72, labels }
    })

    const target = { x: 0, y: 0 }
    const current = { x: 0, y: 0 }
    const pointerRange = { x: 0.5, y: 0.22 }
    let frame = 0
    let time = 0
    let visible = false

    function resize() {
      const width = mount.clientWidth
      const height = mount.clientHeight || 600
      const layout = getSceneLayout(width)
      renderer.setSize(width, height)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      camera.position.set(0, layout.cameraY, layout.cameraZ)
      camera.lookAt(0, 0, 0)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      if (layout.worldScaleX) {
        world.scale.set(layout.worldScaleX, layout.worldScaleY, layout.worldScaleZ)
      } else {
        world.scale.setScalar(layout.worldScale)
      }
      pointerRange.x = layout.pointerX
      pointerRange.y = layout.pointerY
      rings.forEach((ring) => {
        const ringScaleX = width < 520 && ring.radius >= 27 ? 0.62 : width < 520 && ring.radius >= 20 ? 0.8 : 1
        const labelScale = layout.labelScale * (width < 520 && ring.radius >= 27 ? 0.72 : width < 520 && ring.radius >= 20 ? 0.86 : 1)
        ring.group.scale.set(ringScaleX, 1, 1)
        ring.labels.forEach((label) => label.scale.copy(label.userData.baseScale).multiplyScalar(labelScale))
      })
    }

    function onPointerMove(event) {
      const rect = mount.getBoundingClientRect()
      target.x = (event.clientX - rect.left) / rect.width - 0.5
      target.y = (event.clientY - rect.top) / rect.height - 0.5
    }

    function onPointerLeave() {
      target.x = 0
      target.y = 0
    }

    function renderFrame() {
      time += reduced ? 0 : 0.016
      coreA.rotation.y += 0.003
      coreA.rotation.x += 0.0014
      coreB.rotation.y -= 0.0045
      coreB.rotation.z += 0.0022
      coreGlow.material.opacity = 0.85 + Math.sin(time * 2) * 0.12
      rings.forEach((ring) => {
        if (!reduced) ring.group.rotation.y += ring.dir * ring.speed * 0.016
      })
      current.x += (target.x - current.x) * 0.05
      current.y += (target.y - current.y) * 0.05
      world.rotation.y = current.x * pointerRange.x
      world.rotation.x = 0.34 + current.y * pointerRange.y
      renderer.render(scene, camera)
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
    renderFrame()
    window.addEventListener('resize', resize)
    if (!reduced) {
      mount.addEventListener('pointermove', onPointerMove, { passive: true })
      mount.addEventListener('pointerleave', onPointerLeave)
    }

    const observer = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting)
      if (visible) {
        start()
      } else {
        stop()
      }
    }, {
      root: null,
      rootMargin: '220px 0px',
      threshold: 0.01,
    })

    observer.observe(mount)

      cleanupScene = () => {
      stop()
      observer.disconnect()
      window.removeEventListener('resize', resize)
      if (!reduced) {
        mount.removeEventListener('pointermove', onPointerMove)
        mount.removeEventListener('pointerleave', onPointerLeave)
      }
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

  return (
    <div
      className="universe"
      id="universe"
      data-reveal
      data-delay="0.15"
      ref={mountRef}
      role="img"
      aria-label="Technology universe showing Java, Spring Boot, JavaScript, React, Node.js, Python, Flask, MongoDB, PostgreSQL, Redis, Kafka, ELK Stack, Data Engineering, Backend, Frontend, Full-stack, DevOps, and QA."
    />
  )
}
