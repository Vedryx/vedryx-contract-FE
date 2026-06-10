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
          <ol className="pipeline" data-reveal data-delay="0.1">
            <li className="step"><span className="idx">1</span><div><div className="s-t">Developer joins your team</div><div className="s-s">Embedded and shipping from day one.</div></div></li>
            <li className="step decision"><span className="idx">?</span><div><div className="s-t">Not performing?</div><div className="s-s">Delivery, communication, or technical output misses the mark.</div></div><span className="loop">↻ replace</span></li>
            <li className="step"><span className="idx">2</span><div><div className="s-t">Vedryx Core swaps them</div><div className="s-s">A new developer steps in - no PIP, no severance, no added cost.</div></div></li>
            <li className="step loopback"><span className="idx">↻</span><div><div className="s-t">Repeat until it works</div><div className="s-s">Replace as many times as needed until the right developer is doing the job.</div></div></li>
          </ol>
          <aside className="engine-aside" data-reveal data-delay="0.18">
            <div>
              <h3>The performance guarantee</h3>
              <p className="lead aside-copy">Every developer remains employed by Vedryx. You get productive capacity without owning the cost of underperformance.</p>
            </div>
            <ul className="guarantee-list">
              {guarantees.map((item) => (
                <li className="guarantee-row" key={item}><Icon className="g-ico" /><span>{item}</span></li>
              ))}
            </ul>
          </aside>
        </div>
      </div>
    </section>
  )
}
