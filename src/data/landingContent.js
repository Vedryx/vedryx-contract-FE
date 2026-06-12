export const comparison = {
  without: {
    title: 'Without Vedryx',
    subtitle: 'Traditional hiring',
    tone: 'without',
    chips: ['3-6 months lost', 'PIP + severance risk'],
    steps: [
      ['Screen resumes', 'Sift through hundreds before anyone ships'],
      ['Arrange interviews', 'Calls, calendars, panels, and guesswork'],
      ['Make a permanent hire', 'Committed before any real output'],
      ['Underperformance shows late', 'Now you manage PIP, payroll, and delay', 'bad'],
      ['Severance & restart', 'You pay to exit, then hire again', 'bad'],
    ],
  },
  with: {
    title: 'With Vedryx',
    subtitle: 'Dedicated remote developers',
    tone: 'with',
    chips: ['Replacement guarantee', 'No PIP or severance'],
    steps: [
      ['Skip resume screening', 'Vedryx brings pre-vetted dedicated remote developers', 'good'],
      ['Get matched to vetted talent', 'Interview overhead drops to fit review'],
      ['Developer starts full-time', 'Judge performance through real product work'],
      ['Not performing?', 'Vedryx replaces them at no extra cost', 'loop'],
      ['72-hour replacement SLA', 'From your written notice, a vetted replacement shortlist within 72 hours', 'good'],
    ],
  },
}

export const guarantees = [
  'No resume screening',
  'No interview scheduling',
  'No PIP liability',
  'No severance costs',
  'Replacement during the agreed guarantee period',
]

export const noRiskItems = [
  'resume screening',
  'interview scheduling',
  'PIP exposure',
  'severance pay',
  'replacement limits',
]

export const trustStats = [
  ['72h', 'replacement SLA', 'From your written notice of dissatisfaction to a vetted replacement shortlist — within 72 hours.'],
  ['0', 'PIP or severance liability', 'Developers stay employed by Vedryx, so underperformance is not your employment burden.'],
  ['Full-time', 'dedicated developers', 'India-based remote developers work inside your tools, meetings, and delivery workflow.'],
]

export const vettingSignals = [
  'Technical screening',
  'Communication assessment',
  'Delivery-readiness review',
  'Vedryx payroll coverage',
]

export const whyCards = [
  ['shield', 'Risk-Free Engagement', "Decide after you've seen real output from a dedicated developer."],
  ['bolt', 'Fast Team Scaling', 'Add senior engineers in days, not quarters.'],
  ['replace', 'Replacement Guarantee', 'If performance misses, Vedryx swaps at no extra cost during the agreed guarantee period.'],
  ['check', 'No Screening Grind', 'Skip resume piles, cold calls, and interview scheduling.'],
  ['globe', 'India-Based Remote Talent', 'Hire vetted developers from India for global product teams.'],
  ['contract', 'No PIP Or Severance', 'The developer stays on Vedryx payroll, not yours.'],
]

export const decisionSteps = [
  ['Submit requirement', 'Share the role, contact details, and project context.'],
  ['Vedryx reviews fit', 'We assess the requirement against available vetted engineering capacity.'],
  ['Get a callback', 'Vedryx contacts your HR or hiring team by phone or email.'],
  ['Contract offline with Vedryx', 'Commercials, contract, payroll, and developer transactions stay offline with Vedryx.'],
]

export const roleOptions = [
  'Full-stack developer',
  'Frontend developer',
  'Backend developer',
  'Data engineer',
  'Python developer',
  'Java Spring Boot developer',
  'Node.js developer',
  'AI workflow engineer',
  'Cloud or DevOps engineer',
  'Mobile developer',
  'QA automation engineer',
  'Other',
]

export const engagementAssurances = [
  'Developer stays on Vedryx payroll',
  'Replacement at no extra cost during the agreed guarantee period',
  'Contract is between Vedryx and your company',
  'No PIP or severance liability',
]

export const technologyGroups = [
  {
    title: 'Frontend and full-stack developers',
    items: ['React developers', 'JavaScript developers', 'Full-stack developers', 'Frontend developers'],
  },
  {
    title: 'Backend and platform developers',
    items: ['Node.js developers', 'Python developers', 'Java Spring Boot developers', 'Backend developers'],
  },
  {
    title: 'Data, cloud, and quality engineers',
    items: ['Data engineers', 'DevOps engineers', 'Cloud engineers', 'QA automation engineers'],
  },
]

export const serviceAreas = ['United States', 'United Kingdom', 'Europe', 'Australia', 'Middle East', 'India']

/**
 * FAQ content — single source of truth for both the rendered FAQSection and
 * the FAQPage JSON-LD injected into the document head.
 *
 * Each item carries:
 *   - q      : plain question string (exact rendered text)
 *   - a      : array of answer segments, each `{ text, bold? }`. Joining all
 *              `text` values yields the plain-text answer (used by JSON-LD and
 *              the schema.org `Answer/text` microdata property). Segments
 *              marked `bold` render inside <strong> in the DOM.
 *
 * Order is buyer-intent ranked (revised 2026-06-10).
 *
 * Editing rules:
 *   1. The plain-text answer (segments joined) MUST match the visible DOM
 *      character-for-character — that is how Google validates FAQPage.
 *   2. Do NOT add a duplicate FAQPage schema anywhere else on the site.
 *   3. Renumbering is handled in the component (01..0n by index).
 */
export const faqItems = [
  {
    q: 'How does the replacement guarantee actually work?',
    a: [
      { text: 'Unlimited replacement.', bold: true },
      { text: ' That is the promise. If a developer is not the right fit, Vedryx replaces them — ' },
      { text: 'at no extra cost, with no cap on the number of swaps', bold: true },
      { text: '. ' },
      { text: '72-hour replacement SLA', bold: true },
      { text: ': from your written notice of dissatisfaction, Vedryx delivers a vetted replacement shortlist within 72 hours. You are never locked to a hire that is not working. Specific guarantee terms are set out in your engagement contract.' },
    ],
  },
  {
    q: 'How does Vedryx vet developers?',
    a: [
      { text: 'Vedryx Core developers are not freelancers we found yesterday. Every engineer clears ' },
      { text: 'multiple rounds of structured interviews', bold: true },
      { text: ' and is then ' },
      { text: 'hired as a full-time Vedryx employee', bold: true },
      { text: '. Before they ever join a client engagement, they spend time working inside Vedryx on ' },
      { text: 'our own in-house products', bold: true },
      { text: ' — shipping real code, in real repositories, against real deadlines. That is how we verify code quality, delivery discipline, and how someone actually behaves on a team. By the time a developer reaches a client, we have watched them ship.' },
    ],
  },
  {
    q: 'How long is a Vedryx Core engagement?',
    a: [
      { text: 'Engagements are ' },
      { text: 'flexible and shaped around the work', bold: true },
      { text: '. Some clients run a focused build for a few months; others keep the same Vedryx engineer embedded for years. We agree the term and the exit terms with each client directly in the contract so they fit your hiring plan, not a template.' },
    ],
  },
  {
    q: 'Who owns the IP and the code?',
    a: [
      { text: 'You do. ' },
      { text: 'Full assignment.', bold: true },
      { text: ' All work product — code, designs, documentation, infrastructure config — is assigned to your company on creation, written into the master services agreement. Developers commit directly to your repositories under your accounts, sign your NDA in addition to the Vedryx confidentiality clause, and have no residual rights. Vedryx never reuses client code across engagements.' },
    ],
  },
  {
    q: 'How is Vedryx Core different from Toptal, Andela, or Turing?',
    a: [
      { text: 'Three differences clients consistently call out. ' },
      { text: 'One: dedicated, not marketplace', bold: true },
      { text: ' — Vedryx Core engagements are full-time monthly placements, not hourly gigs. ' },
      { text: 'Two: unlimited replacement at no extra cost', bold: true },
      { text: ' — Toptal and Turing typically charge for re-matching or impose multi-week re-vetting cycles. ' },
      { text: 'Three: a single Vedryx-to-client contract', bold: true },
      { text: ' that keeps PIP, severance, and employment liability entirely off your books — the developer stays a Vedryx employee throughout.' },
    ],
  },
]

/**
 * Plain-text answer for JSON-LD. Strips bold flags but keeps the exact words
 * so the structured-data `text` field matches the visible DOM character-for-character.
 */
export function faqAnswerText(item) {
  return item.a.map((seg) => seg.text).join('').trim()
}

/**
 * Builds the FAQPage schema object from `faqItems`. Used by the build-time
 * head-injection script so visible DOM and structured data stay in sync.
 */
export function buildFaqSchema(items = faqItems) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faqAnswerText(item),
      },
    })),
  }
}

