import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { render, buildFaqSchema } from '../dist-ssr/entry-server.js'

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
