import { HeroScene } from './HeroScene.jsx'
import './HeroSection.css'

export function HeroSection() {
  return (
    <header className="hero" id="top">
      <HeroScene />
      <div className="hero-veil" />
      <div className="wrap">
        <div className="hero-badge"><span className="dot" /> Developers stay employed by Vedryx - not your risk</div>
        <h1 className="display" aria-label="Evaluate vetted engineers before committing.">
          <span className="ln"><span>Evaluate vetted</span></span>
          <span className="ln"><span>engineers before committing.</span></span>
        </h1>
        <p className="lead hero-sub">Give product teams qualified engineering capacity while HR keeps employment risk reversible. Validate delivery, communication, and team fit in real work before making a long-term commitment.</p>
        <div className="hero-actions">
          <a href="#submit" className="btn btn-primary">Request Callback <span className="arrow">→</span></a>
          <a href="#submit" className="btn btn-ghost">Contact Vedryx</a>
        </div>
        <div className="hero-proofline" aria-label="Vedryx engagement safeguards">
          <span>First shortlist in 72 hours</span>
          <span>Replacement included</span>
          <span>No severance liability</span>
        </div>
      </div>
    </header>
  )
}
