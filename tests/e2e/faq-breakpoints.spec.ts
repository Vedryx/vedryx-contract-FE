import { test, expect } from 'playwright/test'

/**
 * FAQ section breakpoint verification (eng-002 — desktop split layout).
 *
 * The CSS append in FAQSection.css activates a two-column grid only at
 * min-width: 1025px. Tablet (≤1024) and mobile (≤560) must stay byte-identical
 * to the pre-fix rendering: block layout, header stacked above list, footer
 * flowing in its own row, accordion answers capped at 78ch.
 *
 * We assert against computed styles, not screenshots, so the test is
 * deterministic across font-rendering nuances.
 */

const FAQ_WRAP = '.vdx-faq__wrap'
const FAQ_HEAD = '.vdx-faq__head'
const FAQ_FOOT = '.vdx-faq__foot'
const FAQ_ANSWER = '.vdx-faq__answer'

async function gotoFaq(page) {
  await page.goto('/#faq')
  // Wait for hydration so computed styles reflect the live tree.
  await page.waitForLoadState('domcontentloaded')
  await page.locator(FAQ_WRAP).scrollIntoViewIfNeeded()
}

test.describe('FAQ breakpoints — desktop split layout', () => {
  test('mobile 560px: block layout, no grid on wrap', async ({ page }) => {
    await page.setViewportSize({ width: 560, height: 900 })
    await gotoFaq(page)
    const display = await page.locator(FAQ_WRAP).evaluate((el) => getComputedStyle(el).display)
    expect(display).toBe('block')
    // Answers still capped (78ch rule) — not "none".
    const answerMax = await page
      .locator(FAQ_ANSWER)
      .first()
      .evaluate((el) => getComputedStyle(el).maxWidth)
    expect(answerMax).not.toBe('none')
  })

  test('tablet 1024px: block layout, no grid, no sticky', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await gotoFaq(page)
    const wrapDisplay = await page.locator(FAQ_WRAP).evaluate((el) => getComputedStyle(el).display)
    expect(wrapDisplay).toBe('block')
    const headPosition = await page
      .locator(FAQ_HEAD)
      .evaluate((el) => getComputedStyle(el).position)
    expect(headPosition).toBe('static')
    const answerMax = await page
      .locator(FAQ_ANSWER)
      .first()
      .evaluate((el) => getComputedStyle(el).maxWidth)
    expect(answerMax).not.toBe('none')
  })

  test('desktop 1025px: split grid active, sticky head, answer cap released', async ({ page }) => {
    await page.setViewportSize({ width: 1025, height: 900 })
    await gotoFaq(page)
    const wrapDisplay = await page.locator(FAQ_WRAP).evaluate((el) => getComputedStyle(el).display)
    expect(wrapDisplay).toBe('grid')
    const cols = await page
      .locator(FAQ_WRAP)
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns)
    // Two tracks (e.g. "410.4px 615.6px" or similar)
    expect(cols.split(/\s+/).length).toBe(2)
    const headPosition = await page
      .locator(FAQ_HEAD)
      .evaluate((el) => getComputedStyle(el).position)
    expect(headPosition).toBe('sticky')
    const answerMax = await page
      .locator(FAQ_ANSWER)
      .first()
      .evaluate((el) => getComputedStyle(el).maxWidth)
    expect(answerMax).toBe('none')
    // Foot spans both columns.
    const footColumn = await page
      .locator(FAQ_FOOT)
      .evaluate((el) => getComputedStyle(el).gridColumnStart + '/' + getComputedStyle(el).gridColumnEnd)
    expect(footColumn).toBe('1/-1')
  })

  test('desktop 1280px: split grid active', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await gotoFaq(page)
    const wrapDisplay = await page.locator(FAQ_WRAP).evaluate((el) => getComputedStyle(el).display)
    expect(wrapDisplay).toBe('grid')
  })

  test('desktop 1440px: split grid active', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoFaq(page)
    const wrapDisplay = await page.locator(FAQ_WRAP).evaluate((el) => getComputedStyle(el).display)
    expect(wrapDisplay).toBe('grid')
  })

  test('accordion expand/collapse still animates at 1280px', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await gotoFaq(page)
    // The first item is defaultOpen. Click the second to expand.
    const summaries = page.locator('.vdx-faq__summary')
    const count = await summaries.count()
    expect(count).toBeGreaterThan(1)
    const second = summaries.nth(1)
    const item = page.locator('.vdx-faq__item').nth(1)
    await second.scrollIntoViewIfNeeded()
    const before = await item.evaluate((el) => el.hasAttribute('open'))
    expect(before).toBe(false)
    await second.click()
    // After click, WAAPI animates height; item ends up open with .is-open class.
    await expect(item).toHaveAttribute('open', '')
    await expect(item).toHaveClass(/is-open/)
  })
})
