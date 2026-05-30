import { useEffect, useRef } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import * as THREE from 'three'

const navItems = ['The Difference', 'How It Works', 'Technologies', 'Why Vedryx']

const stats = [
  { value: '600+', label: 'Engineers on the bench' },
  { value: '72h', label: 'To first match' },
  { value: '0%', label: 'Severance liability' },
]

const withoutVedryx = [
  ['01', 'Screen resumes', 'Sift through hundreds by hand'],
  ['02', 'Interview rounds', 'Weeks of rounds and guessing'],
  ['03', 'Permanent hire', 'Committed before real output'],
  ['04', 'Wrong fit, found late', 'Months in and expensive to unwind'],
  ['05', 'Severance and restart', 'Sunk cost while the roadmap stalls'],
]

const withVedryx = [
  ['01', 'Skip resume screening', 'Every engineer is already pre-vetted'],
  ['02', 'Get matched in 72h', 'Ready-to-deploy engineers'],
  ['03', 'Developer starts', 'Embedded and shipping from day one'],
  ['04', 'Not a fit? Swap', 'Replaced instantly, no questions'],
  ['05', 'Zero severance', 'Momentum continues without liability'],
]

const benefits = [
  'No hiring costs',
  'No severance costs',
  'No recruitment overhead',
  'No long hiring cycles',
  'No hidden clauses',
  'Risk-free engagement',
]

const technologies = [
  'React',
  'Node.js',
  'Python',
  'Java',
  'Go',
  'AWS',
  'Kubernetes',
  'AI/ML',
  'Data',
  'Mobile',
  'DevOps',
  'Legacy',
]

const reasons = [
  ['Risk-Free Engagement', 'Decide after you have seen real output.'],
  ['Fast Team Scaling', 'Add senior engineers in days, not quarters.'],
  ['Replacement Guarantee', 'Not a fit? We swap them instantly.'],
  ['Pre-Vetted Engineers', 'Top-tier talent, rigorously screened.'],
  ['Wide Technology Coverage', 'Backend to AI, cloud to mobile.'],
  ['Flexible Contracts', 'Scale up, scale down, no penalties.'],
]

const proofRows = [
  ['Try first', 'See the developer inside your actual team before you commit.'],
  ['Swap fast', 'If fit is off, Vedryx replaces the engineer without severance.'],
  ['Keep momentum', 'Your roadmap keeps moving while Vedryx owns employment risk.'],
]

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
      <path
        fill="currentColor"
        d="M12.3 4.2 18 10l-5.7 5.8-1.4-1.4 3.3-3.4H2V9h12.2l-3.3-3.4 1.4-1.4Z"
      />
    </svg>
  )
}

function SwapIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
        d="M7 7h11l-3-3m3 3-3 3M17 17H6l3 3m-3-3 3-3"
      />
    </svg>
  )
}

function SectionLabel({ children }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">
      <span className="h-1.5 w-1.5 rounded-full bg-orange-400 shadow-[0_0_16px_rgba(249,115,22,0.9)]" />
      {children}
    </span>
  )
}

function PrimaryButton({ children }) {
  return (
    <a
      href="#requirements"
      className="group inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-full bg-orange-500 px-6 py-3 text-sm font-bold text-slate-950 shadow-[0_18px_60px_rgba(249,115,22,0.38)] transition duration-200 hover:bg-orange-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-300"
    >
      {children}
      <ArrowIcon />
    </a>
  )
}

function SecondaryButton({ children }) {
  return (
    <a
      href="#call"
      className="inline-flex min-h-12 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-white/5 px-6 py-3 text-sm font-bold text-white backdrop-blur transition duration-200 hover:border-cyan-200/50 hover:bg-cyan-200/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-200"
    >
      {children}
    </a>
  )
}

function TimelineColumn({ title, subtitle, items, variant }) {
  const isPositive = variant === 'positive'

  return (
    <motion.div
      initial={{ opacity: 0, y: 26 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.55, ease: 'easeOut' }}
      className={`rounded-[28px] border p-5 sm:p-6 ${
        isPositive
          ? 'border-cyan-300/30 bg-cyan-300/[0.08] shadow-[0_0_80px_rgba(14,165,233,0.16)]'
          : 'border-white/10 bg-white/[0.045]'
      }`}
    >
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-400">{subtitle}</p>
          <h3 className="mt-1 text-2xl font-bold text-white">{title}</h3>
        </div>
        {isPositive ? (
          <span className="rounded-full bg-cyan-300 px-3 py-1 text-xs font-bold text-slate-950">Vedryx</span>
        ) : (
          <span className="rounded-full border border-white/10 px-3 py-1 text-xs font-bold text-slate-400">
            Legacy
          </span>
        )}
      </div>

      <div className="space-y-3">
        {items.map(([step, heading, copy]) => (
          <div key={heading} className="grid grid-cols-[44px_1fr] gap-3 rounded-2xl border border-white/10 bg-slate-950/40 p-3">
            <span
              className={`flex h-11 w-11 items-center justify-center rounded-xl text-sm font-bold ${
                isPositive ? 'bg-cyan-300 text-slate-950' : 'bg-white/8 text-slate-300'
              }`}
            >
              {step}
            </span>
            <div>
              <p className="font-semibold text-white">{heading}</p>
              <p className="mt-1 text-sm leading-6 text-slate-400">{copy}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 text-sm font-semibold">
        <div className={`rounded-2xl p-4 ${isPositive ? 'bg-cyan-300 text-slate-950' : 'bg-orange-500/12 text-orange-200'}`}>
          {isPositive ? 'Days to start' : '3-6 months lost'}
        </div>
        <div className={`rounded-2xl p-4 ${isPositive ? 'bg-white text-slate-950' : 'bg-orange-500/12 text-orange-200'}`}>
          {isPositive ? 'Zero severance' : 'Severance cost'}
        </div>
      </div>
    </motion.div>
  )
}

function makeLabel(text, color = '#7dd3fc') {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const context = canvas.getContext('2d')
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.font = '700 44px Space Grotesk, sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillStyle = 'rgba(2, 6, 23, 0.7)'
  context.roundRect(26, 28, 460, 72, 28)
  context.fill()
  context.strokeStyle = color
  context.lineWidth = 2
  context.stroke()
  context.fillStyle = color
  context.fillText(text, 256, 66)

  const texture = new THREE.CanvasTexture(canvas)
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(1.75, 0.44, 1)
  return sprite
}

function ThreeExperience() {
  const mountRef = useRef(null)
  const shouldReduceMotion = useReducedMotion()

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return undefined

    const scene = new THREE.Scene()
    scene.fog = new THREE.FogExp2(0x030712, 0.055)

    const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 80)
    camera.position.set(0, 0.4, 9)

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    mount.appendChild(renderer.domElement)

    const root = new THREE.Group()
    const bench = new THREE.Group()
    const legacy = new THREE.Group()
    const loop = new THREE.Group()
    const tech = new THREE.Group()
    const ribbon = new THREE.Group()
    scene.add(root, bench, legacy, loop, tech, ribbon)

    scene.add(new THREE.AmbientLight(0x6ee7ff, 0.55))
    const keyLight = new THREE.PointLight(0x38bdf8, 32, 22)
    keyLight.position.set(-3, 3, 6)
    scene.add(keyLight)
    const warmLight = new THREE.PointLight(0xf97316, 26, 20)
    warmLight.position.set(4, -2, 5)
    scene.add(warmLight)

    const starPositions = []
    for (let i = 0; i < 1200; i += 1) {
      starPositions.push((Math.random() - 0.5) * 46, (Math.random() - 0.5) * 28, (Math.random() - 0.5) * 34)
    }
    const starGeometry = new THREE.BufferGeometry()
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3))
    const starField = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({ color: 0x7dd3fc, size: 0.025, transparent: true, opacity: 0.55 }),
    )
    root.add(starField)

    const benchMaterial = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 1.25,
      roughness: 0.28,
      metalness: 0.55,
    })
    const orangeMaterial = new THREE.MeshStandardMaterial({
      color: 0xf97316,
      emissive: 0xf97316,
      emissiveIntensity: 1.05,
      roughness: 0.35,
      metalness: 0.5,
    })
    const dimMaterial = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      emissive: 0x334155,
      emissiveIntensity: 0.35,
      roughness: 0.75,
      metalness: 0.2,
    })

    const nodeGeometry = new THREE.IcosahedronGeometry(0.11, 1)
    const benchNodes = []
    for (let i = 0; i < 56; i += 1) {
      const radius = 1.4 + (i % 7) * 0.17
      const angle = i * 0.73
      const y = Math.sin(i * 1.17) * 1.8
      const node = new THREE.Mesh(nodeGeometry, benchMaterial)
      node.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius)
      node.userData.base = node.position.clone()
      benchNodes.push(node)
      bench.add(node)
    }
    bench.position.set(2.25, 0.1, 0)

    const linePositions = []
    for (let i = 0; i < benchNodes.length - 8; i += 3) {
      const a = benchNodes[i].userData.base
      const b = benchNodes[i + 8].userData.base
      linePositions.push(a.x, a.y, a.z, b.x, b.y, b.z)
    }
    const lineGeometry = new THREE.BufferGeometry()
    lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3))
    bench.add(
      new THREE.LineSegments(
        lineGeometry,
        new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.22 }),
      ),
    )
    const benchLabel = makeLabel('VETTED BENCH')
    benchLabel.position.set(0, -2.45, 0)
    bench.add(benchLabel)

    for (let i = 0; i < 8; i += 1) {
      const cube = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), dimMaterial)
      cube.position.set(-2.2 + i * 0.55, Math.sin(i) * 0.45, 0)
      cube.rotation.set(i * 0.4, i * 0.2, 0)
      legacy.add(cube)
    }
    legacy.position.set(-2.4, 0.25, 0)
    const legacyLabel = makeLabel('HIRING RISK', '#fb923c')
    legacyLabel.position.set(0, -1.4, 0)
    legacy.add(legacyLabel)

    const torus = new THREE.Mesh(new THREE.TorusGeometry(1.85, 0.025, 12, 120), orangeMaterial)
    const torusTwo = new THREE.Mesh(new THREE.TorusGeometry(2.25, 0.018, 12, 120), benchMaterial)
    torus.rotation.x = Math.PI / 2
    torusTwo.rotation.x = Math.PI / 2
    loop.add(torus, torusTwo)
    const loopLabel = makeLabel('REPLACE UNTIL RIGHT', '#fb923c')
    loopLabel.position.set(0, -2.25, 0)
    loop.add(loopLabel)

    technologies.forEach((item, index) => {
      const angle = (Math.PI * 2 * index) / technologies.length
      const radius = 2.25
      const marker = new THREE.Mesh(nodeGeometry, index % 3 === 0 ? orangeMaterial : benchMaterial)
      marker.position.set(Math.cos(angle) * radius, Math.sin(index * 0.7) * 0.9, Math.sin(angle) * radius)
      tech.add(marker)
      if (index % 2 === 0) {
        const label = makeLabel(item, index % 3 === 0 ? '#fb923c' : '#7dd3fc')
        label.position.copy(marker.position).multiplyScalar(1.18)
        label.scale.set(1.2, 0.3, 1)
        tech.add(label)
      }
    })
    tech.position.set(0, 0.15, 0)

    const portal = new THREE.Mesh(
      new THREE.TorusKnotGeometry(0.85, 0.16, 140, 16),
      new THREE.MeshStandardMaterial({
        color: 0x7dd3fc,
        emissive: 0x38bdf8,
        emissiveIntensity: 1.5,
        roughness: 0.2,
        metalness: 0.7,
        transparent: true,
        opacity: 0.82,
      }),
    )
    portal.position.set(0, 0, -0.4)
    root.add(portal)

    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-3.2, -1.15, 0),
      new THREE.Vector3(-1.2, 1.25, -0.25),
      new THREE.Vector3(1.15, -0.7, 0.2),
      new THREE.Vector3(3.15, 1.2, 0),
    ])
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(path, 120, 0.035, 12, false),
      new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0ea5e9,
        emissiveIntensity: 1.4,
        roughness: 0.24,
        metalness: 0.4,
        transparent: true,
        opacity: 0.72,
      }),
    )
    ribbon.add(tube)

    const cursorState = { x: 0, y: 0, targetX: 0, targetY: 0 }
    const handlePointerMove = (event) => {
      cursorState.targetX = (event.clientX / window.innerWidth) * 2 - 1
      cursorState.targetY = -((event.clientY / window.innerHeight) * 2 - 1)
    }

    const scrollState = { value: 0 }
    const handleScroll = () => {
      const maxScroll = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1)
      scrollState.value = window.scrollY / maxScroll
      const isMobile = window.innerWidth < 640
      const heroOpacity = isMobile ? 0.34 : 0.72
      const contentBase = isMobile ? 0.18 : 0.36
      const contentFloor = isMobile ? 0.1 : 0.18
      const opacity = scrollState.value < 0.16 ? heroOpacity : Math.max(contentFloor, contentBase - scrollState.value * 0.18)
      document.documentElement.style.setProperty('--scene-opacity', opacity.toFixed(2))
    }
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight
      camera.updateProjectionMatrix()
      renderer.setSize(window.innerWidth, window.innerHeight)
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('pointermove', handlePointerMove, { passive: true })
    window.addEventListener('resize', handleResize)
    handleScroll()

    let frameId = 0
    const clock = new THREE.Clock()
    const animate = () => {
      const elapsed = clock.getElapsedTime()
      const progress = scrollState.value
      const activeChapter = Math.min(Math.floor(progress * 5.2), 4)

      cursorState.x += (cursorState.targetX - cursorState.x) * 0.07
      cursorState.y += (cursorState.targetY - cursorState.y) * 0.07

      camera.position.x += ((progress - 0.5) * 2.1 + cursorState.x * 0.55 - camera.position.x) * 0.035
      camera.position.y += (0.6 - progress * 0.8 + cursorState.y * 0.35 - camera.position.y) * 0.035
      camera.lookAt(0, 0, 0)

      root.rotation.y = elapsed * 0.035 + progress * 1.2 + cursorState.x * 0.14
      root.rotation.x = cursorState.y * 0.08
      starField.rotation.y = elapsed * 0.01
      portal.rotation.x = elapsed * 0.35
      portal.rotation.y = elapsed * 0.55
      portal.scale.setScalar(1 + Math.abs(cursorState.x) * 0.12 + Math.abs(cursorState.y) * 0.08)

      bench.visible = activeChapter === 0 || activeChapter === 2 || activeChapter === 4
      legacy.visible = activeChapter === 1
      loop.visible = activeChapter === 2 || activeChapter === 3
      tech.visible = activeChapter === 3
      ribbon.visible = activeChapter === 0 || activeChapter === 2 || activeChapter === 4

      bench.rotation.y = elapsed * 0.22
      bench.rotation.x = cursorState.y * 0.18
      benchNodes.forEach((node, index) => {
        const base = node.userData.base
        const wave = Math.sin(elapsed * 1.7 + index * 0.42 + cursorState.x * 2) * 0.055
        node.position.set(
          base.x + cursorState.x * 0.18 * Math.sin(index),
          base.y + wave + cursorState.y * 0.12 * Math.cos(index * 0.7),
          base.z + cursorState.x * 0.12 * Math.cos(index),
        )
      })
      legacy.rotation.y = -elapsed * 0.18
      legacy.children.forEach((child, index) => {
        if (child.isMesh) child.position.y += Math.sin(elapsed * 2 + index) * 0.0018
      })
      loop.rotation.z = elapsed * 0.22
      loop.rotation.y = elapsed * 0.18 + cursorState.x * 0.22
      tech.rotation.y = elapsed * 0.18 + cursorState.x * 0.2
      ribbon.rotation.y = cursorState.x * 0.2
      ribbon.rotation.x = cursorState.y * 0.12

      const reducedOpacity = shouldReduceMotion ? 0.55 : 1
      root.children.forEach((child) => {
        if (child.material) child.material.opacity = child === portal ? 0.82 * reducedOpacity : child.material.opacity
      })

      renderer.render(scene, camera)
      if (!shouldReduceMotion) frameId = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      cancelAnimationFrame(frameId)
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('resize', handleResize)
      document.documentElement.style.removeProperty('--scene-opacity')
      mount.removeChild(renderer.domElement)
      scene.traverse((object) => {
        if (object.geometry) object.geometry.dispose()
        if (object.material) {
          if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose())
          else object.material.dispose()
        }
      })
      renderer.dispose()
    }
  }, [shouldReduceMotion])

  return <div ref={mountRef} className="three-stage" aria-hidden="true" />
}

function App() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#030712] text-slate-100">
      <ThreeExperience />
      <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(circle_at_20%_10%,rgba(14,165,233,0.28),transparent_28%),radial-gradient(circle_at_80%_0%,rgba(249,115,22,0.16),transparent_24%),linear-gradient(180deg,#030712_0%,#07111f_48%,#030712_100%)]" />
      <div className="pointer-events-none fixed inset-0 z-0 grid-overlay opacity-45" />

      <header className="sticky top-0 z-30 border-b border-white/10 bg-slate-950/70 backdrop-blur-xl">
        <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <a href="#" className="cursor-pointer text-xl font-bold tracking-tight text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-200">
            Vedryx
          </a>
          <div className="hidden items-center gap-7 lg:flex">
            {navItems.map((item) => (
              <a key={item} href={`#${item.toLowerCase().replaceAll(' ', '-')}`} className="cursor-pointer text-sm font-medium text-slate-300 transition hover:text-white">
                {item}
              </a>
            ))}
          </div>
          <div className="hidden items-center gap-3 sm:flex">
            <SecondaryButton>Book a Call</SecondaryButton>
            <PrimaryButton>Submit Requirements</PrimaryButton>
          </div>
        </nav>
      </header>

      <section className="relative z-10 mx-auto grid min-h-[calc(100vh-82px)] max-w-7xl items-center gap-12 px-4 pb-20 pt-16 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:px-8 lg:pb-28 lg:pt-24">
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: 'easeOut' }}>
          <SectionLabel>Developers stay employed by Vedryx</SectionLabel>
          <h1 className="mt-7 max-w-4xl text-5xl font-bold leading-[0.94] tracking-tight text-white sm:text-7xl lg:text-8xl">
            Try developers before committing.
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-300 sm:text-xl">
            Access pre-vetted software engineers without taking on hiring risk. If someone is not the right fit, we replace them until they are.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <PrimaryButton>Submit Requirements</PrimaryButton>
            <SecondaryButton>Book a Call</SecondaryButton>
          </div>
          <div className="mt-10 grid max-w-2xl grid-cols-3 gap-3">
            {stats.map((stat, index) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.28 + index * 0.08, ease: 'easeOut' }}
                whileHover={{ y: -4, borderColor: 'rgba(125,211,252,0.42)' }}
                className="rounded-2xl border border-white/10 bg-white/[0.055] p-4 backdrop-blur"
              >
                <p className="text-3xl font-bold text-white sm:text-4xl">{stat.value}</p>
                <p className="mt-2 text-xs leading-5 text-slate-400 sm:text-sm">{stat.label}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 28 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.7, delay: 0.18, ease: 'easeOut' }}
          className="hero-glass rounded-[34px] border border-cyan-200/20 p-6 shadow-[0_0_120px_rgba(14,165,233,0.18)] backdrop-blur-xl"
        >
          <div className="scan-surface relative overflow-hidden rounded-[26px] border border-white/10 bg-black/35 p-6">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-cyan-200">Interactive talent bench</p>
            <h2 className="mt-4 text-3xl font-bold leading-tight text-white sm:text-4xl">Move your cursor. The bench bends with you.</h2>
            <p className="mt-4 leading-7 text-slate-300">
              The background reacts to motion and scrolls through risk, replacement, stack coverage, and deployment.
            </p>
            <div className="mt-8 grid grid-cols-3 gap-3">
              {['Bench', 'Swap', 'Scale'].map((item) => (
                <div key={item} className="rounded-2xl border border-white/10 bg-white/[0.07] p-3 text-center text-sm font-semibold text-white">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </section>

      <section id="the-difference" className="relative z-10 mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="content-shell p-6 sm:p-10 lg:p-12">
        <div className="mx-auto max-w-3xl text-center">
          <SectionLabel>With vs without Vedryx</SectionLabel>
          <h2 className="mt-5 text-4xl font-bold tracking-tight text-white sm:text-6xl">One requirement. Two very different outcomes.</h2>
          <p className="mt-5 text-lg leading-8 text-slate-300">Same role, same start date, but the journey and risk look nothing alike.</p>
        </div>
        <div className="mt-12 grid gap-5 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
          <TimelineColumn title="Without Vedryx" subtitle="Traditional hiring" items={withoutVedryx} />
          <motion.div
            initial={{ opacity: 0, scale: 0.7, rotate: -18 }}
            whileInView={{ opacity: 1, scale: 1, rotate: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 0.55, ease: 'easeOut' }}
            className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-white/15 bg-white/8 text-sm font-black text-white shadow-[0_0_55px_rgba(255,255,255,0.12)]"
          >
            VS
          </motion.div>
          <TimelineColumn title="With Vedryx" subtitle="Risk-free capacity" items={withVedryx} variant="positive" />
        </div>
        </div>
      </section>

      <section id="how-it-works" className="relative z-10 py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="content-shell p-6 sm:p-10 lg:p-12">
          <div className="max-w-3xl">
            <SectionLabel>How it works</SectionLabel>
            <h2 className="mt-5 text-4xl font-bold tracking-tight text-white sm:text-6xl">The loop that makes hiring reversible.</h2>
          </div>
          <div className="mt-12 grid gap-4 lg:grid-cols-4">
            {[
              ['1', 'Developer joins your team', 'Embedded and shipping from day one.'],
              ['?', 'Not the right fit?', 'Culture, communication, or technical mismatch.'],
              ['2', 'Instant replacement', 'A new engineer steps in with zero severance.'],
              ['swap', 'Repeat until it is right', 'At no extra cost, for as long as it takes.'],
            ].map(([mark, title, copy], index) => (
              <motion.div
                key={title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.45, ease: 'easeOut', delay: index * 0.06 }}
                whileHover={{ y: -8, borderColor: 'rgba(125,211,252,0.38)' }}
                className="relative overflow-hidden rounded-[26px] border border-white/10 bg-slate-950/60 p-6"
              >
                <span className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/80 to-transparent" />
                <div className="mb-8 flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-300 text-xl font-black text-slate-950">
                  {mark === 'swap' ? <SwapIcon /> : mark}
                </div>
                <h3 className="text-xl font-bold text-white">{title}</h3>
                <p className="mt-3 leading-7 text-slate-400">{copy}</p>
              </motion.div>
            ))}
          </div>
          <div className="mt-5 rounded-[28px] border border-orange-300/20 bg-orange-400/10 p-6 lg:flex lg:items-center lg:justify-between">
            <div>
              <h3 className="text-2xl font-bold text-white">The replacement guarantee</h3>
              <p className="mt-2 max-w-3xl leading-7 text-slate-300">Every engineer remains employed by Vedryx. You get the output without owning the employment risk.</p>
            </div>
            <div className="mt-5 flex flex-wrap gap-2 lg:mt-0 lg:max-w-md lg:justify-end">
              {benefits.map((benefit) => (
                <span key={benefit} className="rounded-full border border-white/10 bg-white/8 px-3 py-2 text-sm font-semibold text-slate-200">
                  {benefit}
                </span>
              ))}
            </div>
          </div>
          </div>
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="content-shell grid gap-10 p-6 sm:p-10 lg:grid-cols-[0.82fr_1.18fr] lg:p-12">
          <div>
            <SectionLabel>Risk-free engagement</SectionLabel>
            <h2 className="mt-5 text-4xl font-bold tracking-tight text-white sm:text-6xl">Stop betting on resumes.</h2>
            <p className="mt-6 text-lg leading-8 text-slate-300">
              Traditional hiring asks you to make permanent decisions before real performance. Vedryx lets you work with developers first and decide later.
            </p>
            <div className="mt-8">
              <PrimaryButton>Submit Requirements</PrimaryButton>
            </div>
          </div>
          <div className="grid gap-3">
            {proofRows.map(([title, copy], index) => (
              <motion.div
                key={title}
                initial={{ opacity: 0, x: 24 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.45, delay: index * 0.07, ease: 'easeOut' }}
                className="grid gap-4 rounded-[24px] border border-white/10 bg-white/[0.045] p-5 sm:grid-cols-[120px_1fr] sm:items-center"
              >
                <p className="text-sm font-bold uppercase tracking-[0.2em] text-cyan-200">{title}</p>
                <p className="text-lg leading-8 text-slate-200">{copy}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section id="technologies" className="relative z-10 mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="content-shell relative overflow-hidden p-6 sm:p-10 lg:p-12">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
            <div className="relative z-10">
              <SectionLabel>Technology universe</SectionLabel>
              <h2 className="mt-5 text-4xl font-bold tracking-tight text-white sm:text-6xl">Every stack orbits one deployable bench.</h2>
              <p className="mt-5 text-lg leading-8 text-slate-300">From legacy monoliths to frontier AI, the right specialist is already on the bench.</p>
            </div>
            <div className="relative z-10 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {technologies.map((tech, index) => (
                <motion.div
                  key={tech}
                  initial={{ opacity: 0, y: 22, filter: 'blur(8px)' }}
                  whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  viewport={{ once: true, amount: 0.2 }}
                  transition={{ duration: 0.45, delay: index * 0.035, ease: 'easeOut' }}
                  whileHover={{ y: -5, borderColor: 'rgba(251,146,60,0.5)', backgroundColor: 'rgba(15,23,42,0.88)' }}
                  className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-5 text-center font-bold text-white"
                >
                  {tech}
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="why-vedryx" className="relative z-10 mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="content-shell p-6 sm:p-10 lg:p-12">
        <div className="max-w-3xl">
          <SectionLabel>Why Vedryx</SectionLabel>
          <h2 className="mt-5 text-4xl font-bold tracking-tight text-white sm:text-6xl">Capacity you can scale and unwind at will.</h2>
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {reasons.map(([title, copy], index) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.25 }}
              transition={{ duration: 0.45, delay: index * 0.04, ease: 'easeOut' }}
              whileHover={{ y: -8, scale: 1.015 }}
              className="rounded-[24px] border border-white/10 bg-white/[0.055] p-6 transition duration-200 hover:border-cyan-200/40 hover:bg-cyan-200/[0.075]"
            >
              <h3 className="text-xl font-bold text-white">{title}</h3>
              <p className="mt-3 leading-7 text-slate-400">{copy}</p>
            </motion.div>
          ))}
        </div>
        </div>
      </section>

      <section id="requirements" className="relative z-10 mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-[36px] border border-orange-300/25 bg-[linear-gradient(135deg,rgba(14,165,233,0.18),rgba(249,115,22,0.18))] p-8 sm:p-12 lg:p-16">
          <div className="max-w-3xl">
            <SectionLabel>Your move</SectionLabel>
            <h2 className="mt-5 text-4xl font-bold tracking-tight text-white sm:text-6xl">Your next developer should prove it first.</h2>
            <p className="mt-6 text-lg leading-8 text-slate-200">Build faster without taking hiring risks. Tell us what you need and we will have a match in front of you within 72 hours.</p>
          </div>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <PrimaryButton>Submit Requirements</PrimaryButton>
            <SecondaryButton>Book a Call</SecondaryButton>
          </div>
        </div>
      </section>

      <footer id="call" className="relative z-10 border-t border-white/10 px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[1.4fr_repeat(3,0.6fr)]">
          <div>
            <p className="text-2xl font-bold text-white">Vedryx</p>
            <p className="mt-3 max-w-md leading-7 text-slate-400">Risk-free engineering capacity. Try developers before committing. We replace them until they are right.</p>
          </div>
          {[
            ['Platform', 'How it works', 'Technologies', 'Why Vedryx'],
            ['Company', 'About', 'Careers', 'Security', 'Contact'],
            ['Get started', 'Submit requirements', 'Book a call'],
          ].map(([heading, ...links]) => (
            <div key={heading}>
              <p className="font-bold text-white">{heading}</p>
              <div className="mt-3 space-y-2">
                {links.map((link) => (
                  <a key={link} href="#" className="block cursor-pointer text-sm text-slate-400 transition hover:text-white">
                    {link}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="mx-auto mt-10 flex max-w-7xl flex-col gap-3 border-t border-white/10 pt-6 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>(c) 2026 Vedryx. All rights reserved.</p>
          <p>Developers employed by Vedryx, never your liability.</p>
        </div>
      </footer>
    </main>
  )
}

export default App
