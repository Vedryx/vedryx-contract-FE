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
            <p className="lead statement-copy" data-reveal data-delay="0.1">Traditional hiring burns time on resume screening, calls, interview panels, and then locks you into PIP or severance if performance fails. Vedryx Core lets you see real work first. If the developer does not perform, we replace them at no extra cost, as many times as it takes.</p>
            <a href="#submit" className="btn btn-primary statement-action" data-reveal data-delay="0.15">Request Callback <span className="arrow">→</span></a>
          </div>
          <ul className="no-list" data-reveal data-delay="0.12">
            {noRiskItems.map((item) => (
              <li className="no" key={item}><Icon name="x" className="x" /><span><span className="no-mark">No</span> {item}</span></li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
