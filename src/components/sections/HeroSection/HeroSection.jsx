import { HeroScene } from './HeroScene.jsx'
import './HeroSection.css'

export function HeroSection() {
  return (
    <header className="hero" id="top">
      <HeroScene />
      <div className="hero-veil" />
      <div className="wrap">
        <div className="hero-badge"><span className="dot" /> No PIP, no severance, unlimited replacement</div>
        <h1 className="display" aria-label="Try vetted developers. Replace until they perform.">
          <span className="ln"><span>Try vetted developers.</span></span>
          <span className="ln"><span>Replace until they perform.</span></span>
        </h1>
        <p className="lead hero-sub">
          <span className="hero-sub-desktop">Vedryx removes the hiring drag of resume screening, calls, and interview scheduling. If a developer does not perform, Vedryx replaces them at no extra cost, as many times as needed, while you avoid PIP and severance liability.</span>
          <span className="hero-sub-mobile">Skip resume screening and interview drag. Get vetted developers, then replace underperformers at no extra cost.</span>
        </p>
        <div className="hero-actions">
          <a href="#submit" className="btn btn-primary">Request Callback <span className="arrow">→</span></a>
          <a href="#submit" className="btn btn-ghost">Contact Vedryx</a>
        </div>
        <div className="hero-proofline" aria-label="Vedryx engagement safeguards">
          <span>First shortlist in 72 hours</span>
          <span>Unlimited replacement</span>
          <span>No PIP or severance liability</span>
        </div>
      </div>
    </header>
  )
}
