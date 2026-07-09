import { useEffect, useRef } from 'react'
import { faqItems } from '../../../data/landingContent.js'
import './FAQSection.css'

const EASE = 'cubic-bezier(.2,.7,.2,1)'

function pad(n) {
  return n.toString().padStart(2, '0')
}

function renderAnswer(segments) {
  return segments.map((seg, i) =>
    seg.bold ? <strong key={i}>{seg.text}</strong> : <span key={i}>{seg.text}</span>,
  )
}

function FAQItem({ item, index, defaultOpen }) {
  const detailsRef = useRef(null)
  const summaryRef = useRef(null)
  const animRef = useRef(null)

  useEffect(() => {
    const details = detailsRef.current
    const summary = summaryRef.current
    if (!details || !summary) return

    if (defaultOpen) {
      details.classList.add('is-open')
    }

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) return undefined

    function settle(open) {
      details.open = open
      details.classList.toggle('is-open', open)
      details.style.height = ''
      details.style.overflow = ''
      animRef.current = null
    }

    function onClick(e) {
      e.preventDefault()
      if (animRef.current) animRef.current.cancel()
      details.style.overflow = 'hidden'
      const startH = details.offsetHeight

      if (!details.open || details.classList.contains('is-closing')) {
        // EXPAND
        details.classList.remove('is-closing')
        details.open = true
        details.classList.add('is-open')
        const endH = details.offsetHeight
        details.style.height = `${startH}px`
        const anim = details.animate(
          { height: [`${startH}px`, `${endH}px`] },
          { duration: 420, easing: EASE },
        )
        animRef.current = anim
        anim.onfinish = () => settle(true)
      } else {
        // COLLAPSE — keep [open] until the height animation lands so the answer
        // stays rendered while shrinking.
        details.classList.remove('is-open')
        details.classList.add('is-closing')
        const anim = details.animate(
          { height: [`${startH}px`, `${summary.offsetHeight + 1}px`] },
          { duration: 320, easing: EASE },
        )
        animRef.current = anim
        anim.onfinish = () => {
          details.classList.remove('is-closing')
          settle(false)
        }
      }
    }

    summary.addEventListener('click', onClick)
    return () => {
      summary.removeEventListener('click', onClick)
      if (animRef.current) animRef.current.cancel()
    }
  }, [defaultOpen])

  // Note: AEO/structured data is delivered via the FAQPage JSON-LD injected at
  // build time (scripts/prerender.mjs) — same source array (faqItems) so the
  // visible DOM and the schema stay in sync character-for-character. Inline
  // microdata was intentionally dropped from this React tree because React 19
  // serializes `itemScope`/`itemProp`/`itemType` in camelCase, which is not
  // valid HTML5 microdata. JSON-LD alone is fully accepted by Google's
  // FAQPage rich-result pipeline; the microdata "belt + braces" layer added
  // noise without value in this stack.
  return (
    <li data-reveal data-delay={Math.min(0.07 * (index + 1), 0.16)}>
      <details ref={detailsRef} className="vdx-faq__item" open={defaultOpen}>
        <summary ref={summaryRef} className="vdx-faq__summary">
          <span className="vdx-faq__num" aria-hidden="true">{pad(index + 1)}</span>
          <span className="vdx-faq__q">{item.q}</span>
          <span className="vdx-faq__icon" aria-hidden="true"></span>
        </summary>
        <div className="vdx-faq__answer">
          <p>{renderAnswer(item.a)}</p>
        </div>
      </details>
    </li>
  )
}

const DEFAULT_TITLE = (
  <>The things hiring teams<br /><em>actually ask</em> us first.</>
)

const DEFAULT_LEAD =
  'The replacement promise, how we vet, who owns the code, and how Vedryx Hire differs from a marketplace. Straight answers — written by the team who signs the contracts, not by marketing.'

export function FAQSection({
  items = faqItems,
  eyebrow = 'Questions before signing',
  title = DEFAULT_TITLE,
  lead = DEFAULT_LEAD,
}) {
  return (
    <section
      className="section-pad vdx-faq"
      id="faq"
      aria-labelledby="vdx-faq-title"
    >
      <div className="wrap vdx-faq__wrap">
        <header className="vdx-faq__head">
          <div>
            <span className="vdx-faq__eyebrow" data-reveal>{eyebrow}</span>
            <h2
              id="vdx-faq-title"
              className="section-title product-title vdx-faq__title"
              data-reveal
              data-delay="0.05"
            >
              {title}
            </h2>
          </div>
          <p className="vdx-faq__lead" data-reveal data-delay="0.1">{lead}</p>
        </header>

        <ul className="vdx-faq__list" role="list">
          {items.map((item, index) => (
            <FAQItem
              key={item.q}
              item={item}
              index={index}
              defaultOpen={index === 0}
            />
          ))}
        </ul>

        <div className="vdx-faq__foot" role="note" data-reveal>
          <p className="vdx-faq__foot-copy">
            <strong>Talk to us about your team needs.</strong>{' '}
            Drop your details on the callback form and a Vedryx partner will be in touch.
          </p>
          <a href="#submit" className="btn btn-primary vdx-faq__cta">
            Request Callback <span className="arrow" aria-hidden="true">→</span>
          </a>
        </div>
      </div>
    </section>
  )
}
