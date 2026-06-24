import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { render, buildFaqSchema } from '../dist-ssr/entry-server.js'
import {
  comparison,
  decisionSteps,
  engagementAssurances,
  faqAnswerText,
  faqItems,
  guarantees,
  roleOptions,
  serviceAreas,
  technologyGroups,
  trustStats,
  vettingSignals,
  whyCards,
} from '../src/data/landingContent.js'

const distDir = resolve('dist')
const indexPath = resolve(distDir, 'index.html')
const template = await readFile(indexPath, 'utf8')
const appHtml = render('/')

if (!template.includes('<div id="root"></div>')) {
  throw new Error('Expected empty root element in built index.html')
}

// Build FAQPage JSON-LD from the same content array the React component
// renders. Keeps visible DOM and structured data in sync per AEO rules.
const faqSchema = buildFaqSchema()
const faqScript = `<script type="application/ld+json" data-vdx-faq-schema>${JSON.stringify(faqSchema)}</script>`

let injected = template
if (injected.includes('data-vdx-faq-schema')) {
  // Idempotent re-runs (should never happen during a clean build, but defensive).
  injected = injected.replace(/<script type="application\/ld\+json" data-vdx-faq-schema>[\s\S]*?<\/script>/, faqScript)
} else if (injected.includes('</head>')) {
  injected = injected.replace('</head>', `    ${faqScript}\n  </head>`)
} else {
  throw new Error('Expected </head> in built index.html for FAQPage schema injection')
}

await writeFile(indexPath, injected.replace('<div id="root"></div>', `<div id="root">${appHtml}</div>`))

function list(items) {
  return items.map((item) => `- ${item}`).join('\n')
}

function tableRows(rows) {
  return rows.map(([title, label, detail]) => `| ${title} | ${label} | ${detail} |`).join('\n')
}

const markdown = `# Vedryx

Dedicated remote developers without hiring liability.

Vedryx provides pre-vetted India-based remote developers for companies that need senior engineering capacity without resume screening, interview scheduling, PIP exposure, severance costs, or replacement limits.

## Who Vedryx Is For

Hiring teams, engineering leaders, HR teams, and founders in the United States, United Kingdom, Europe, Australia, the Middle East, and India who need dedicated remote developers embedded in their existing workflows.

## Core Offer

${list(guarantees)}

## Trust Signals

| Signal | Label | Detail |
|---|---|---|
${tableRows(trustStats)}

## Why Companies Use Vedryx

${whyCards.map((card) => `### ${card[1]}\n${card[2]}`).join('\n\n')}

## With Vedryx

${comparison.with.steps.map(([title, detail]) => `- **${title}:** ${detail}`).join('\n')}

## Without Vedryx

${comparison.without.steps.map(([title, detail]) => `- **${title}:** ${detail}`).join('\n')}

## Decision Path

${decisionSteps.map(([title, detail]) => `- **${title}:** ${detail}`).join('\n')}

## Available Roles

${list(roleOptions)}

## Technology Groups

${technologyGroups.map((group) => `### ${group.title}\n${list(group.items)}`).join('\n\n')}

## Vetting Signals

${list(vettingSignals)}

## Engagement Assurances

${list(engagementAssurances)}

## Service Areas

${list(serviceAreas)}

## FAQ

${faqItems.map((item) => `### ${item.q}\n${faqAnswerText(item)}`).join('\n\n')}

## Request A Callback

Companies can request a callback through the site form. The WebMCP tool \`request_callback\` is also exposed in browsers that support \`navigator.modelContext.provideContext()\`.
`

await writeFile(resolve(distDir, 'index.md'), markdown)
