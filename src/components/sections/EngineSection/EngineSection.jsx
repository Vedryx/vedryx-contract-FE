import { guarantees } from '../../../data/landingContent.js'
import { Icon } from '../../ui/Icon/Icon.jsx'
import './EngineSection.css'

export function EngineSection() {
  return (
    <section className="section-pad product-section bg-band" id="engine">
      <div className="wrap">
        <span className="eyebrow" data-reveal>How it works</span>
        <h2 className="section-title product-title engine-title" data-reveal data-delay="0.05">The loop that makes hiring reversible.</h2>
        <div className="engine">
          <div className="pipeline" data-reveal data-delay="0.1">
            <div className="step"><span className="idx">1</span><div><div className="s-t">Developer joins your team</div><div className="s-s">Embedded and shipping from day one.</div></div></div>
            <div className="step decision"><span className="idx">?</span><div><div className="s-t">Not the right fit?</div><div className="s-s">Culture, communication, or technical mismatch.</div></div><span className="loop">↻ any reason</span></div>
            <div className="step"><span className="idx">2</span><div><div className="s-t">Instant replacement</div><div className="s-s">A new engineer steps in - zero severance, zero gap.</div></div></div>
            <div className="step loopback"><span className="idx">↻</span><div><div className="s-t">Repeat until it's right</div><div className="s-s">At no extra cost, for as long as it takes.</div></div></div>
          </div>
          <aside className="engine-aside" data-reveal data-delay="0.18">
            <div>
              <h3>The replacement guarantee</h3>
              <p className="lead aside-copy">Every engineer remains employed by Vedryx. You get the output without owning the employment risk.</p>
            </div>
            <div>
              {guarantees.map((item) => (
                <div className="guarantee-row" key={item}><Icon className="g-ico" /><span>{item}</span></div>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </section>
  )
}
