import { test, expect } from 'playwright/test'

/**
 * Smoke: the prerendered HTML must contain the hero copy and the JSON-LD
 * graph BEFORE React hydrates. This is the SSR proof — if it fails, the
 * site has silently regressed to a CSR shell and crawlers see nothing.
 *
 * We assert against the raw HTTP response body (not the live DOM) so we
 * are not measuring hydration, only the server-rendered output.
 */
test.describe('homepage SSR output', () => {
  let html: string

  test.beforeAll(async ({ request }) => {
    const response = await request.get('/')
    expect(response.status()).toBe(200)
    html = await response.text()
  })

  test('renders hero copy in the SSR HTML', async () => {
    expect(html).toContain('Try vetted developers.')
    expect(html).toContain('Replace until they perform.')
    // Hero badge and proofline must also be present pre-hydration.
    expect(html).toContain('No PIP, no severance, unlimited replacement')
    expect(html).toContain('72-hour replacement SLA')
  })

  test('renders canonical URL and OG tags in head', async () => {
    expect(html).toContain('<link rel="canonical" href="https://vedryxtech.com/"')
    expect(html).toMatch(/<meta property="og:title" content="Vedryx \| Hire Dedicated Remote Developers"/)
    expect(html).toContain('<meta property="og:url" content="https://vedryxtech.com/"')
    expect(html).toContain('<meta property="og:image"')
  })

  test('renders Organization, WebSite, and Service JSON-LD blocks', async () => {
    // Pull the JSON-LD payload out of the head.
    const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
    expect(ldMatch, 'JSON-LD script block missing from SSR HTML').not.toBeNull()
    const ld = JSON.parse(ldMatch![1])
    expect(ld['@context']).toBe('https://schema.org')
    expect(Array.isArray(ld['@graph'])).toBe(true)
    const types = ld['@graph'].map((n: { '@type': string }) => n['@type'])
    expect(types).toContain('Organization')
    expect(types).toContain('WebSite')
    expect(types).toContain('Service')
  })

  test('hero is visible after hydration', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Try vetted developers.')
  })
})
