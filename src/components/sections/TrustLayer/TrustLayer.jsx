import { trustStats, vettingSignals } from '../../../data/landingContent.js'
import './TrustLayer.css'

export function TrustLayer() {
  return (
    <section className="trust-layer" id="trust" aria-label="Vedryx Core trust and vetting signals">
      <div className="wrap">
        <div className="trust-panel" data-reveal>
          <div className="trust-intro">
            <span className="eyebrow">Built for product-company hiring teams</span>
            <p>Evaluate delivery, communication, and team fit from full-time dedicated remote developers without becoming liable for PIP, severance, or another hiring cycle. Vedryx Core keeps the developer relationship operationally reversible.</p>
          </div>

          <div className="trust-stats" aria-label="Vedryx Core engagement proof points">
            {trustStats.map(([value, label, copy]) => (
              <article className="trust-stat" key={label}>
                <strong>{value}</strong>
                <span>{label}</span>
                <p>{copy}</p>
              </article>
            ))}
          </div>

          <div className="vetting-strip" aria-label="Vedryx Core vetting includes">
            <span>Vetting includes</span>
            <ul>
              {vettingSignals.map((item) => (
                <li key={item}>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}
