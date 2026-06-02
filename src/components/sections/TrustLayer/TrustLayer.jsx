import { trustStats, vettingSignals } from '../../../data/landingContent.js'
import './TrustLayer.css'

export function TrustLayer() {
  return (
    <section className="trust-layer" aria-label="Vedryx trust and vetting signals">
      <div className="wrap">
        <div className="trust-panel" data-reveal>
          <div className="trust-intro">
            <span className="eyebrow">Built for product-company hiring teams</span>
            <p>Evaluate delivery, communication, and team fit before adding employment risk. Vedryx keeps the developer relationship operationally reversible.</p>
          </div>

          <div className="trust-stats" aria-label="Vedryx engagement proof points">
            {trustStats.map(([value, label, copy]) => (
              <article className="trust-stat" key={label}>
                <strong>{value}</strong>
                <span>{label}</span>
                <p>{copy}</p>
              </article>
            ))}
          </div>

          <div className="vetting-strip" aria-label="Vedryx vetting includes">
            <span>Vetting includes</span>
            <div>
              {vettingSignals.map((item) => (
                <b key={item}>{item}</b>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
