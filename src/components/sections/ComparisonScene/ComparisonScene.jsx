import { comparison } from '../../../data/landingContent.js'
import './ComparisonScene.css'

function ComparisonColumn({ item }) {
  return (
    <div className={`compare-col ${item.tone}`}>
      <div className="cc-head"><span className="cc-tag">{item.title}</span><span className="cc-sub">{item.subtitle}</span></div>
      <ol className="csteps">
        {item.steps.map(([title, copy, state], index) => (
          <li className={`cstep ${state || ''}`} key={title}>
            <span className="cnum">{String(index + 1).padStart(2, '0')}</span>
            <div>
              <div className="ct">{title}{state === 'loop' && <span className="loop-pill">↻ swap</span>}</div>
              <div className="cs">{copy}</div>
            </div>
          </li>
        ))}
      </ol>
      <div className="cc-foot">
        {item.chips.map((chip) => <span className={`cchip ${item.tone === 'with' ? 'good' : 'bad'}`} key={chip}>{chip}</span>)}
      </div>
    </div>
  )
}

export function ComparisonScene() {
  return (
    <section className="section-pad utility-section compare-section" id="problem">
      <div className="wrap">
        <span className="eyebrow" data-reveal>With vs without Vedryx</span>
        <h2 className="section-title utility-title compact-title" data-reveal data-delay="0.05">One requirement. Two very different outcomes.</h2>
        <p className="lead compare-lead" data-reveal data-delay="0.1">Same requirement, very different risk: traditional hiring makes you screen, interview, manage underperformance, and pay to exit.</p>
        <div className="compare" data-reveal data-delay="0.15">
          <ComparisonColumn item={comparison.without} />
          <div className="vs"><span>VS</span></div>
          <ComparisonColumn item={comparison.with} />
        </div>
      </div>
    </section>
  )
}
