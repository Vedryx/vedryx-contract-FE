import './ClosingSection.css'

export function ClosingSection() {
  return (
    <section className="section-pad closing" id="final-cta">
      <div className="wrap">
        <span className="eyebrow centered" data-reveal>Your move</span>
        <h2 className="display closing-title" data-reveal data-delay="0.05">Your next developer<br />should prove it first.</h2>
        <p className="lead" data-reveal data-delay="0.1">Build faster without taking hiring risks. Tell us what you need - we'll have a match in front of you within 72 hours.</p>
        <div className="closing-actions" data-reveal data-delay="0.15">
          <a href="#submit" className="btn btn-primary">Request Callback <span className="arrow">→</span></a>
          <a href="#submit" className="btn btn-ghost">Contact Vedryx</a>
        </div>
      </div>
    </section>
  )
}
