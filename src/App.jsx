import { useEffect, useMemo, useRef, useState } from 'react'

const trialSignals = [
  ['Resume maze', 'Polished profiles still hide delivery risk.', 'risk'],
  ['Permanent bet', 'Long commitments start before real proof.', 'risk'],
  ['Late mismatch', 'Fit problems surface after momentum is lost.', 'risk'],
  ['Live trial', 'A vetted developer ships in your real sprint.', 'proof'],
  ['Fit gate', 'Output, communication, and culture are checked early.', 'proof'],
  ['Swap path', 'If fit is wrong, replacement is built into the model.', 'proof'],
]

const flowSteps = [
  ['Developer starts', 'A vetted engineer joins live project work.'],
  ['Good fit?', 'You review output, speed, communication, and team fit.'],
  ['Keep shipping', 'Yes path: continue with confidence.'],
  ['Swap fast', 'No path: Vedryx replaces and returns to the same fit gate.'],
]
const techPlanets = [
  ['React', 'UI engineer', 'planet-react'],
  ['Next.js', 'Product web', 'planet-next'],
  ['TypeScript', 'App systems', 'planet-ts'],
  ['Node', 'API engineer', 'planet-node'],
  ['Python', 'Automation', 'planet-python'],
  ['AI/ML', 'AI workflow', 'planet-ai'],
  ['Cloud', 'Platform', 'planet-cloud'],
  ['Kubernetes', 'Infra ops', 'planet-k8s'],
  ['Mobile', 'App engineer', 'planet-mobile'],
  ['Data', 'Pipelines', 'planet-data'],
  ['DevOps', 'Delivery', 'planet-devops'],
  ['QA', 'Quality', 'planet-qa'],
  ['Security', 'Hardening', 'planet-security'],
  ['Legacy', 'Modernization', 'planet-legacy'],
]

const requirementFields = [
  ['Role', 'Full-stack developer'],
  ['Stack', 'React + Node + AI'],
  ['Sprint goal', 'Ship customer workflow'],
  ['Start', 'Trial-ready this week'],
]

const matchChecks = ['Vetted match', 'Trial plan', 'Swap path']

const metrics = [
  ['2-week', 'trial window before long commitment'],
  ['48h', 'replacement path when fit is off'],
  ['14+', 'delivery stacks and roles covered by vetted talent'],
]

const roleCards = [
  ['Frontend', 'React, Next.js, UI systems, product surfaces'],
  ['Backend', 'Node, APIs, integrations, distributed services'],
  ['AI workflow', 'LLM features, automations, internal tools'],
  ['Platform', 'Cloud, Kubernetes, infrastructure, observability'],
  ['DevOps', 'CI/CD, release automation, delivery reliability'],
  ['Mobile', 'React Native, app delivery, release support'],
  ['Data', 'Pipelines, analytics, product intelligence'],
  ['QA automation', 'Test strategy, automation suites, release confidence'],
  ['Security', 'App hardening, reviews, compliance support'],
  ['Modernization', 'Legacy systems, migrations, maintainability upgrades'],
]

const faqs = [
  ['What happens if the developer is not a fit?', 'Vedryx replaces the developer and returns you to the same fit gate, so the trial remains useful instead of becoming a sunk cost.'],
  ['Is this staff augmentation or project delivery?', 'The model is talent-first but output-focused. You get a developer aligned to your sprint context, with fit measured through real work.'],
  ['How quickly can a trial start?', 'The site currently presents a trial-ready-this-week promise. In production, connect this form to your actual qualification and scheduling process.'],
  ['Can we keep the developer after the trial?', 'Yes. The continue path is the intended outcome when delivery quality, communication, and culture fit are confirmed.'],
]

const sceneStops = [0, 0.68, 0.9, 0.972, 1]
const sceneTransitionMs = 1150

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value))
}

function segment(progress, start, end) {
  return clamp((progress - start) / (end - start))
}

function App() {
  const storyRef = useRef(null)
  const progressRef = useRef(0)
  const sceneRef = useRef(0)
  const snapFrameRef = useRef(0)
  const snapTimerRef = useRef(0)
  const isSnappingRef = useRef(false)
  const touchStartYRef = useRef(0)
  const [progress, setProgress] = useState(0)
  const [cursor, setCursor] = useState({ x: 0, y: 0 })
  const [drag, setDrag] = useState({ x: 0, y: 0, active: false })

  useEffect(() => {
    let frame = 0

    function getStoryMetrics() {
      const story = storyRef.current
      if (!story) return null

      const max = Math.max(story.offsetHeight - window.innerHeight, 1)
      return {
        top: story.offsetTop,
        bottom: story.offsetTop + max,
        max,
      }
    }

    function nearestSceneIndex(value) {
      return sceneStops.reduce((best, stop, index) => {
        const currentDistance = Math.abs(value - stop)
        const bestDistance = Math.abs(value - sceneStops[best])
        return currentDistance < bestDistance ? index : best
      }, 0)
    }

    function update() {
      const metrics = getStoryMetrics()
      const nextProgress = metrics ? clamp((window.scrollY - metrics.top) / metrics.max) : 0
      progressRef.current = nextProgress
      setProgress(nextProgress)

      if (!isSnappingRef.current) {
        sceneRef.current = nearestSceneIndex(nextProgress)
      }

      frame = 0
    }

    function onScroll() {
      if (!frame) frame = requestAnimationFrame(update)
    }

    function onPointerMove(event) {
      setCursor({
        x: (event.clientX / window.innerWidth - 0.5) * 2,
        y: (event.clientY / window.innerHeight - 0.5) * 2,
      })
    }

    function animateToScene(nextScene) {
      const metrics = getStoryMetrics()
      if (!metrics) return

      const scene = clamp(nextScene, 0, sceneStops.length - 1)
      const target = metrics.top + metrics.max * sceneStops[scene]
      const start = window.scrollY
      const distance = target - start
      const startedAt = performance.now()

      cancelAnimationFrame(snapFrameRef.current)
      clearTimeout(snapTimerRef.current)
      isSnappingRef.current = true
      sceneRef.current = scene

      function step(now) {
        const elapsed = clamp((now - startedAt) / sceneTransitionMs)
        const eased = elapsed < 0.5
          ? 4 * elapsed * elapsed * elapsed
          : 1 - ((-2 * elapsed + 2) ** 3) / 2

        window.scrollTo({ top: start + distance * eased, behavior: 'instant' })

        if (elapsed < 1) {
          snapFrameRef.current = requestAnimationFrame(step)
          return
        }

        window.scrollTo({ top: target, behavior: 'instant' })
        isSnappingRef.current = false
        update()
      }

      snapFrameRef.current = requestAnimationFrame(step)
    }

    function isInsideStory() {
      const metrics = getStoryMetrics()
      if (!metrics) return false
      return window.scrollY >= metrics.top - 2 && window.scrollY <= metrics.bottom + 2
    }

    function snapByDirection(direction, event) {
      if (!isInsideStory()) return

      const currentScene = sceneRef.current
      const atFirstScene = currentScene === 0 && direction < 0
      const atLastScene = currentScene === sceneStops.length - 1 && direction > 0

      if (atFirstScene || atLastScene) return

      event?.preventDefault()

      if (isSnappingRef.current) return
      animateToScene(currentScene + direction)
    }

    function onWheel(event) {
      if (Math.abs(event.deltaY) < 8) return
      snapByDirection(event.deltaY > 0 ? 1 : -1, event)
    }

    function onKeyDown(event) {
      const nextKeys = ['ArrowDown', 'PageDown', 'Space']
      const previousKeys = ['ArrowUp', 'PageUp']

      if (nextKeys.includes(event.code)) snapByDirection(1, event)
      if (previousKeys.includes(event.code)) snapByDirection(-1, event)
    }

    function onTouchStart(event) {
      touchStartYRef.current = event.touches[0]?.clientY ?? 0
    }

    function onTouchMove(event) {
      if (isInsideStory()) event.preventDefault()
    }

    function onTouchEnd(event) {
      const endY = event.changedTouches[0]?.clientY ?? touchStartYRef.current
      const delta = touchStartYRef.current - endY
      if (Math.abs(delta) < 36) return
      snapByDirection(delta > 0 ? 1 : -1, event)
    }

    function scheduleSettledSnap() {
      if (!isInsideStory() || isSnappingRef.current) return

      clearTimeout(snapTimerRef.current)
      snapTimerRef.current = window.setTimeout(() => {
        if (!isInsideStory() || isSnappingRef.current) return
        animateToScene(nearestSceneIndex(progressRef.current))
      }, 180)
    }

    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('scroll', scheduleSettledSnap, { passive: true })
    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd, { passive: false })
    window.addEventListener('pointermove', onPointerMove, { passive: true })

    return () => {
      cancelAnimationFrame(frame)
      cancelAnimationFrame(snapFrameRef.current)
      clearTimeout(snapTimerRef.current)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('scroll', scheduleSettledSnap)
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('pointermove', onPointerMove)
    }
  }, [])

  const vars = useMemo(() => {
    const keyhole = segment(progress, 0.2, 0.34)
    const door = segment(progress, 0.32, 0.48)
    const trial = segment(progress, 0.52, 0.7)
    const loop = segment(progress, 0.8, 0.89)
    const orbitCollapse = segment(progress, 0.99, 1)
    const final = segment(progress, 0.992, 1)

    return {
      '--p': progress,
      '--cursor-x': cursor.x,
      '--cursor-y': cursor.y,
      '--hero-out': segment(progress, 0.3, 0.42),
      '--keyhole-scale': 1 + keyhole * 6,
      '--door-open': door,
      '--door-scene-opacity': 1 - segment(progress, 0.44, 0.54),
      '--peek-opacity': 1 - segment(progress, 0.2, 0.26),
      '--trial-opacity': segment(progress, 0.5, 0.56) * (1 - segment(progress, 0.72, 0.8)),
      '--trial-exit': segment(progress, 0.72, 0.8),
      '--trial-p': trial,
      '--risk-0': segment(trial, 0.02, 0.22),
      '--risk-1': segment(trial, 0.16, 0.38),
      '--risk-2': segment(trial, 0.3, 0.52),
      '--proof-0': segment(trial, 0.42, 0.64),
      '--proof-1': segment(trial, 0.56, 0.78),
      '--proof-2': segment(trial, 0.7, 0.92),
      '--handoff': segment(trial, 0.74, 1),
      '--loop-enter': segment(progress, 0.78, 0.84),
      '--loop-p': loop,
      '--loop-exit': segment(progress, 0.89, 0.93),
      '--loop-opacity': segment(progress, 0.78, 0.84) * (1 - segment(progress, 0.905, 0.935)),
      '--loop-spin': `${loop * 310}deg`,
      '--universe-enter': segment(progress, 0.938, 0.955),
      '--universe-copy-opacity': 1 - segment(progress, 0.988, 0.996),
      '--orbit-collapse': orbitCollapse,
      '--universe-opacity': segment(progress, 0.938, 0.955) * (1 - segment(progress, 0.995, 1)),
      '--final-opacity': final,
      '--final-scale': 0.86 + final * 0.14,
      '--solar-x': `${drag.x}px`,
      '--solar-y': `${drag.y}px`,
    }
  }, [cursor.x, cursor.y, drag.x, drag.y, progress])

  function handleSolarPointerDown(event) {
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag((current) => ({ ...current, active: true }))
  }

  function handleSolarPointerMove(event) {
    if (!drag.active) return
    setDrag((current) => ({
      ...current,
      x: clamp(current.x + event.movementX * 0.9, -140, 140),
      y: clamp(current.y + event.movementY * 0.9, -90, 90),
    }))
  }

  function handleSolarPointerUp() {
    setDrag((current) => ({ ...current, active: false }))
  }

  return (
    <main className="site-shell" style={vars}>
      <header className="story-nav">
        <a className="brand-mark" href="#top">Vedryx</a>
        <nav aria-label="Primary navigation">
          <a href="#roles">Roles</a>
          <a href="#faq">FAQ</a>
        </nav>
        <a className="nav-cta" href="#contact">Start a trial</a>
      </header>

      <div className="scroll-story" id="top" ref={storyRef}>
      <section className="sticky-world" aria-label="Vedryx animated product story">
        <div className="hero-copy">
          <span>Scene 01</span>
          <h1>Hire developers on proof, not promises.</h1>
          <p>Vedryx lets teams start with vetted developers in real work, validate fit quickly, and replace without slowing the roadmap.</p>
          <div className="hero-actions">
            <a href="#contact">Submit requirements</a>
            <small>Trial model. Replacement path. Production-ready teams.</small>
          </div>
        </div>

        <div className="door-world">
          <div className="ambient-grid" />
          <div className="door-light" />
          <div className="door half-left" />
          <div className="door half-right" />
          <div className="keyhole-window">
            <div className="peek-world">
              <div className="peek-card">With vs without Vedryx</div>
              <div className="peek-card">Proof before commitment</div>
              <div className="peek-card">Replacement built in</div>
            </div>
          </div>
        </div>

        <div className="trial-scene">
          <div className="trial-copy">
            <span>Scene 02</span>
            <h2>Turn hiring risk into trial evidence.</h2>
            <p>The old path asks you to trust resumes. Vedryx moves risk through a live trial where proof appears before commitment.</p>
          </div>

          <div className="trial-system" aria-label="Vedryx trial model">
            <div className="risk-bank">
              {trialSignals.slice(0, 3).map(([title, copy, type], index) => (
                <article className={`signal-card ${type} signal-${index}`} key={title}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </article>
              ))}
            </div>

            <div className="trial-core">
              <div className="core-rings" />
              <div className="core-beam" />
              <div className="developer-node">
                <b>Dev</b>
                <small>starts in sprint</small>
              </div>
              <div className="core-label">
                <span>Vedryx trial</span>
                <strong>Proof before commitment</strong>
              </div>
            </div>

            <div className="proof-bank">
              {trialSignals.slice(3).map(([title, copy, type], index) => (
                <article className={`signal-card ${type} proof-${index}`} key={title}>
                  <span>{String(index + 4).padStart(2, '0')}</span>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </article>
              ))}
            </div>

            <div className="handoff-path">
              <span>feeds the fit decision</span>
            </div>
          </div>
        </div>

        <div className="loop-scene">
          <div className="scene-copy">
            <span>Scene 03</span>
            <h2>The fit decision is built in.</h2>
            <p>If the developer fits, keep shipping. If not, Vedryx swaps the developer and returns you to the same quality gate.</p>
          </div>
          <div className="flow-diagram">
            <div className="flow-line" />
            <div className="flow-pulse" />
            {flowSteps.map(([title, copy], index) => (
              <article className={`flow-card flow-${index}`} key={title}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="universe-scene">
          <div className="scene-copy">
            <span>Scene 04</span>
            <h2>Coverage across the stack.</h2>
            <p>The model works across frontend, backend, AI, cloud, mobile, data, DevOps, and modernization roles.</p>
          </div>
          <div
            className={`orbit-map ${drag.active ? 'dragging' : ''}`}
            onPointerDown={handleSolarPointerDown}
            onPointerMove={handleSolarPointerMove}
            onPointerUp={handleSolarPointerUp}
            onPointerCancel={handleSolarPointerUp}
          >
            <div className="axis-line" />
            <div className="solar-tilt">
              <div className="sun-core">Vedryx</div>
              {techPlanets.map(([item, label, planetClass], index) => (
                <div className={`orbit-shell orbit-${index}`} key={item}>
                  <b className={`tech-planet ${planetClass}`}>
                    <span>{item}</span>
                    <small>{label}</small>
                    {item === 'DevOps' && <i />}
                  </b>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="final-scene">
          <div className="final-copy">
            <span>Scene 05</span>
            <h2>Your requirements become a matched trial.</h2>
            <p>Send the role, stack, and sprint context. Vedryx turns it into a developer match with a measurable trial path.</p>
            <a href="#contact">Submit requirements</a>
          </div>
          <div className="match-console" aria-label="Requirements become a matched developer trial">
            <div className="console-orbit-stream">
              <i />
              <i />
              <i />
            </div>

            <div className="requirements-panel">
              <div className="panel-header">
                <span>Project brief</span>
                <b>Intake</b>
              </div>
              <div className="requirement-list">
                {requirementFields.map(([label, value], index) => (
                  <div className={`requirement-row req-${index}`} key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
            </div>

            <div className="match-bridge">
              <span />
              <span />
              <span />
            </div>

            <div className="developer-match">
              <div className="match-status">Trial ready</div>
              <div className="avatar-grid">
                <span>VD</span>
                <i />
              </div>
              <h3>Matched developer</h3>
              <p>Senior full-stack engineer aligned to your sprint goal.</p>
              <div className="match-checks">
                {matchChecks.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="scroll-length" aria-hidden="true" />
      </div>

      <section className="proof-strip" aria-label="Vedryx proof points">
        {metrics.map(([value, label]) => (
          <div className="metric" key={value}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </section>

      <section className="site-section roles-section" id="roles">
        <div className="section-heading">
          <span>Talent coverage</span>
          <h2>One model for the roles that move product roadmaps.</h2>
          <p>Use the same trial-first motion across focused contributors, modernization work, and full-stack product delivery.</p>
        </div>

        <div className="roles-grid">
          {roleCards.map(([title, copy]) => (
            <article className="role-card" key={title}>
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="site-section intake-section" id="contact">
        <div className="section-heading compact">
          <span>Start a trial</span>
          <h2>Send the role. Get the match path.</h2>
          <p>Use this intake to capture the minimum context needed for a production handoff.</p>
        </div>

        <form className="requirements-form" onSubmit={(event) => event.preventDefault()}>
          <label>
            Work email
            <input type="email" name="email" placeholder="you@company.com" autoComplete="email" required />
          </label>
          <label>
            Role needed
            <select name="role" defaultValue="full-stack">
              <option value="full-stack">Full-stack developer</option>
              <option value="frontend">Frontend developer</option>
              <option value="backend">Backend developer</option>
              <option value="ai">AI workflow engineer</option>
              <option value="devops">Cloud or DevOps engineer</option>
            </select>
          </label>
          <label className="form-wide">
            Sprint context
            <textarea name="context" placeholder="Stack, project goal, timeline, and what a good first sprint should produce." rows="5" required />
          </label>
          <button type="submit">Submit requirements</button>
        </form>
      </section>

      <section className="site-section faq-section" id="faq">
        <div className="section-heading compact">
          <span>Questions</span>
          <h2>What teams usually ask before starting.</h2>
        </div>

        <div className="faq-list">
          {faqs.map(([question, answer]) => (
            <details key={question}>
              <summary>{question}</summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </section>

      <footer className="site-footer">
        <strong>Vedryx</strong>
        <span>Trial-first developer hiring for teams that need proof before commitment.</span>
        <a href="#contact">Start a trial</a>
      </footer>
    </main>
  )
}

export default App
