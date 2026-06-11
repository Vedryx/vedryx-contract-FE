import { useState } from 'react'
import { decisionSteps, engagementAssurances, roleOptions } from '../../../data/landingContent.js'
import { track } from '../../../utils/posthog.js'
import './DecisionPathSection.css'

export function DecisionPathSection() {
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const payload = Object.fromEntries(formData.entries())

    setError('')
    setSubmitting(true)
    track('form_submit_attempt', {
      site: 'vedryx-core-web',
      role: payload.role || 'unknown',
    })

    try {
      const response = await fetch('/api/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const result = await response.json().catch(() => ({}))
      if (!response.ok || !result.ok) {
        throw new Error(result.message || 'Unable to submit the request right now.')
      }

      form.reset()
      setSubmitted(true)
      track('form_submit_success', {
        site: 'vedryx-core-web',
        role: payload.role || 'unknown',
      })
    } catch (submitError) {
      setError(submitError.message)
      setSubmitted(false)
      track('form_submit_error', {
        site: 'vedryx-core-web',
        role: payload.role || 'unknown',
        kind: 'client_or_api_error',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="section-pad product-section decision-path-section" id="submit">
      <div className="wrap">
        <div className="decision-path-head">
          <div>
            <span className="eyebrow" data-reveal>HR decision path</span>
            <h2 className="section-title product-title decision-title" data-reveal data-delay="0.05">Submit the requirement. Vedryx handles the hiring risk.</h2>
          </div>
          <p className="lead decision-copy" data-reveal data-delay="0.1">
            Share the role context and contact details. Vedryx reviews the requirement, calls your team back, and handles the offline engagement with your company while the developer remains on Vedryx payroll.
          </p>
        </div>

        <div className="decision-path-grid">
          <div className="decision-steps" data-reveal data-delay="0.12" aria-label="Vedryx requirement process">
            {decisionSteps.map(([title, copy], index) => (
              <article className="decision-step" key={title}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </div>
              </article>
            ))}
          </div>

          <form className="decision-form" onSubmit={handleSubmit} data-reveal data-delay="0.16">
            <div className="form-head">
              <span>Requirement callback</span>
              <p>Vedryx may contact you by phone or email after reviewing the requirement.</p>
            </div>

            <div className="form-grid">
              <label className="form-trap" aria-hidden="true">
                <span>Website</span>
                <input type="text" name="website" tabIndex="-1" autoComplete="off" />
              </label>
              <label>
                <span>Work email <span className="required-mark">Required</span></span>
                <input type="email" name="email" autoComplete="email" required />
              </label>
              <label>
                <span>Phone number <span className="required-mark">Required</span></span>
                <input type="tel" name="phone" autoComplete="tel" required />
              </label>
              <label>
                <span>Company name</span>
                <input type="text" name="company" autoComplete="organization" />
              </label>
              <label>
                <span>Role needed <span className="required-mark">Required</span></span>
                <select name="role" defaultValue={roleOptions[0]} required>
                  {roleOptions.map((role) => (
                    <option value={role} key={role}>{role}</option>
                  ))}
                </select>
              </label>
              <label className="form-wide">
                <span>Requirement summary <span className="required-mark">Required</span></span>
                <textarea name="summary" rows="4" required aria-describedby="requirement-help" />
                <small id="requirement-help">Include stack, seniority, timeline, and what the first work should prove.</small>
              </label>
            </div>

            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Submitting...' : 'Request Callback'} <span className="arrow">→</span>
            </button>

            {error && (
              <p className="form-error" role="alert">{error}</p>
            )}

            {submitted && (
              <p className="form-success" role="status">Requirement received. Vedryx will contact you by phone or email.</p>
            )}
          </form>
        </div>

        <div className="engagement-assurances" data-reveal data-delay="0.18" aria-label="Vedryx engagement terms">
          {engagementAssurances.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </div>

      {submitted && (
        <div className="callback-modal" role="dialog" aria-modal="true" aria-labelledby="callback-modal-title">
          <div className="callback-modal-panel">
            <span className="eyebrow">Request received</span>
            <h3 id="callback-modal-title">Vedryx will contact you shortly.</h3>
            <p>We have received your requirement. Our team will review it and contact you by phone or email.</p>
            <button type="button" className="btn btn-primary" onClick={() => setSubmitted(false)}>Close</button>
          </div>
        </div>
      )}
    </section>
  )
}
