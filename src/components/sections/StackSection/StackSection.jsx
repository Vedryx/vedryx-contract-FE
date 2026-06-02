import { TechUniverse } from './TechUniverse.jsx'
import './StackSection.css'

export function StackSection() {
  return (
    <section className="section-pad product-section" id="stack">
      <div className="wrap center">
        <span className="eyebrow centered" data-reveal>Technology universe</span>
        <h2 className="section-title product-title stack-title" data-reveal data-delay="0.05">Every stack orbits one matching engine.</h2>
        <p className="lead stack-copy" data-reveal data-delay="0.1">From legacy monoliths to frontier AI - the right specialist is already in orbit.</p>
      </div>
      <div className="wrap">
        <TechUniverse />
      </div>
    </section>
  )
}
