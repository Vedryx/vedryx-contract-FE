import './ClosingSection.css'

export function ClosingSection() {
  return (
    <section className="section-pad closing" id="final-cta">
      <div className="wrap">
        <span className="eyebrow centered" data-reveal>Your move</span>
        <h2 className="display closing-title" data-reveal data-delay="0.05">Your next developer<br />should perform first.</h2>
        <p className="lead" data-reveal data-delay="0.1">Tell us what you need. Vedryx Core brings vetted developers, replaces non-performers at no extra cost, and keeps PIP or severance off your books.</p>
        <div className="closing-actions" data-reveal data-delay="0.15">
          <a href="#submit" className="btn btn-primary">Request Callback <span className="arrow">→</span></a>
          <a href="#submit" className="btn btn-ghost">Contact Vedryx</a>
        </div>
      </div>
    </section>
  )
}
