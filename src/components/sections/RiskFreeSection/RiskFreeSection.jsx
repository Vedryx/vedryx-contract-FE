import { noRiskItems } from '../../../data/landingContent.js'
import { Icon } from '../../ui/Icon/Icon.jsx'
import './RiskFreeSection.css'

export function RiskFreeSection() {
  return (
    <section className="section-pad product-section" id="riskfree">
      <div className="wrap">
        <div className="statement">
          <div>
            <span className="eyebrow" data-reveal>Risk-free engagement</span>
            <h2 className="section-title product-title statement-title" data-reveal data-delay="0.05">Stop betting on resumes.</h2>
            <p className="lead statement-copy" data-reveal data-delay="0.1">Traditional hiring forces companies to make permanent decisions before seeing real performance. Vedryx lets you work with developers first and decide later. If someone doesn't fit your culture, communication style, or technical expectations - we replace them.</p>
            <a href="#submit" className="btn btn-primary statement-action" data-reveal data-delay="0.15">Request Callback <span className="arrow">→</span></a>
          </div>
          <div className="no-list" data-reveal data-delay="0.12">
            {noRiskItems.map((item) => (
              <div className="no" key={item}><Icon name="x" className="x" /><span><s>No</s> {item}</span></div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
