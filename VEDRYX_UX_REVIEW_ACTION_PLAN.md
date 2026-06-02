# Vedryx UX Review Action Plan

## Context

Vedryx is a premium B2B hiring and engineering-capacity product for product companies. The primary audience is HR and talent leaders who need to support product teams without taking on unnecessary hiring risk. The website should feel premium, calm, credible, and operationally clear.

## Finding 1: Trust Layer

### Issue

The page had strong visual impact, but it did not surface enough trust signals early enough. HR users need proof before they emotionally buy into a model that changes normal hiring behavior.

### Plan

- Add a trust layer immediately after the hero.
- Use restrained metrics rather than loud marketing numbers.
- Explain that developers remain employed by Vedryx during evaluation.
- Show what vetting includes: technical screening, communication assessment, delivery-readiness review, and payroll coverage.
- Keep the section visually aligned with the existing dark premium design.

### Status

Implemented.

## Finding 2: Hero Message Clarity

### Issue

The original hero message was visually premium but too broad. It did not immediately tell HR leaders what Vedryx reduces: employment risk, severance exposure, and poor-fit hiring cost.

### Plan

- Replace the generic headline with a clearer premium B2B promise.
- Make the supporting copy speak to HR and product-company realities.
- Add short proof markers directly below the hero CTA.
- Remove redundant old metrics so the first viewport feels calmer.
- Reduce the hero visual intensity so the 3D scene supports the message instead of competing with it.

### Status

Implemented.

## Finding 3: Scroll Feel And Motion Control

### Issue

The site looked strong, but scroll behavior previously felt laggy and unpredictable. Premium websites should feel deliberate and smooth, especially when motion is central to the experience.

### Plan

- Keep scroll interactions simple and avoid heavy scroll-snapping unless it creates a clear storytelling benefit.
- Prefer native scroll for content sections.
- Use `requestAnimationFrame` only where animation must track frame updates.
- Avoid layout reads and writes inside the same scroll frame.
- Respect `prefers-reduced-motion`.
- Test slow scrolling, fast scrolling, trackpad scrolling, and mobile touch scrolling.

### Status

Implemented.

## Finding 4: Visual Hierarchy Between Sections

### Issue

Several sections had similar visual weight, which can make the page feel like a sequence of impressive panels rather than a guided buying journey.

### Plan

- Give each major section a distinct job: promise, proof, comparison, process, coverage, benefits, CTA.
- Reduce repeated large headings where the section is operational rather than emotional.
- Use quieter spacing and smaller type in dense product sections.
- Keep CTA placement consistent and purposeful.

### Status

Implemented.

## Finding 5: HR Decision Path

### Issue

The page explained the model, but the decision path for HR users could be more explicit: what they submit, what Vedryx returns, how evaluation works, and what happens if fit fails.

### Plan

- Add or strengthen a simple intake-to-shortlist explanation.
- Use HR-safe language: evaluation, shortlist, payroll coverage, replacement, no severance liability.
- Avoid overly technical language in sections aimed at HR.
- Keep deeper tech coverage available but secondary.

### Status

Implemented.

## Finding 6: Premium Credibility Without Fake Logos

### Issue

The page needs credibility, but adding fake client logos or unsupported claims would damage trust.

### Plan

- Use process-based credibility instead of fabricated social proof.
- Show vetting standards, replacement terms, and evaluation safeguards.
- If real customer proof becomes available, add logos or quotes later.
- Keep every proof claim defensible.

## Finding 7: CTA Specificity

### Issue

The CTAs are clear, but they can better reflect the real first step for this audience.

### Plan

- Use `Request Callback` as the primary CTA across the page.
- Use `Contact Vedryx` as the secondary CTA.
- Point both CTA variants to the callback intake section.
- Remove dead booking anchors unless a real booking flow is added later.
- Ensure anchors land on the right section and do not feel abrupt.

### Status

Implemented.

## Finding 8: Technology Universe Readability

### Issue

The 3D technology universe is visually premium, but labels and lines can become busy. For HR users, this section should communicate breadth without visual friction.

### Plan

- Keep label contrast high.
- Prevent guide/spoke lines from crossing over label text.
- Reduce line opacity where needed.
- Ensure the canvas is readable on mobile and does not require precision interaction.
- Treat the 3D scene as proof of breadth, not the main conversion driver.

### Status

Implemented.

## Finding 9: Mobile Experience

### Issue

Premium feel often breaks on mobile when dense layouts, long buttons, or animated canvases compete for limited space.

### Plan

- Test at 375px, 390px, 768px, 1024px, and desktop.
- Ensure no horizontal overflow.
- Keep hero CTAs readable and tappable.
- Stack proof markers and comparison panels cleanly.
- Reduce animation intensity on smaller screens.

### Status

Implemented.

## Finding 10: Performance And Bundle Weight

### Issue

Three.js gives the page its premium motion layer, but it increases bundle size. The current build warns about a large JavaScript chunk.

### Plan

- Lazy-load Three.js scenes where possible.
- Keep canvas animation cleanup strict.
- Dispose geometries, materials, textures, and renderers.
- Avoid duplicate canvases after route or section remounts.
- Consider code-splitting the 3D scenes once the visual direction is stable.

### Status

Implemented.

## Verification Checklist

- Run `npm run lint`.
- Run `npm run build`.
- Browser-check desktop and mobile.
- Confirm no horizontal overflow.
- Confirm hero canvas renders.
- Confirm technology labels do not have line overlap.
- Confirm CTAs and anchors work.
- Confirm old unused UI blocks are removed.
- Confirm motion respects reduced-motion preference.
