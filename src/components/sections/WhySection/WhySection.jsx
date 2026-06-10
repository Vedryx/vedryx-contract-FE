import { whyCards } from '../../../data/landingContent.js'
import { Icon } from '../../ui/Icon/Icon.jsx'
import './WhySection.css'

export function WhySection() {
  return (
    <section className="section-pad utility-section bg-band" id="why">
      <div className="wrap">
        <span className="eyebrow" data-reveal>Why companies choose Vedryx Core</span>
        <h2 className="section-title utility-title why-title" data-reveal data-delay="0.05">Capacity you can scale and unwind at will.</h2>
        <div className="why-grid">
          {whyCards.map(([icon, title, copy], index) => (
            <div className="why-card" data-reveal data-delay={(index % 4) * 0.04} key={title}>
              <Icon name={icon} className="w-ico" />
              <div className="w-t">{title}</div>
              <div className="w-s">{copy}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
