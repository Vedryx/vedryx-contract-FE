# Vedryx contract site

React 19 + Vite 8 + Tailwind 4 + Three.js. SSR via `vite build --ssr` plus
`scripts/prerender.mjs` (mutates the built `dist/index.html` to embed the
server-rendered app shell). Deploys to Vercel. Callback form posts to
`api/callback.js` and lands in MongoDB `callback_requests` with
`source: 'vedryx-landing'`.

## Local development

```bash
npm install
npm run dev          # vite dev server
npm run build        # client + SSR + prerender (writes dist/)
npm run preview      # serve dist/ on http://127.0.0.1:4173
npm run lint
```

## Tests

End-to-end smoke is Playwright (Chromium only). Specs live in `tests/e2e/`.

```bash
npm run build        # required first — tests serve dist/ via vite preview
npm run test:e2e
```

Coverage today:

- `tests/e2e/homepage.spec.ts` — asserts the prerendered HTML contains
  hero copy, canonical URL, OG tags, and the `Organization` / `WebSite` /
  `Service` JSON-LD blocks BEFORE React hydrates. This is the gate that
  catches a silent CSR regression.
- `tests/e2e/callback-form.spec.ts` — happy path on the requirement
  callback form. `/api/callback` is intercepted with `page.route()` so
  the test NEVER writes to prod MongoDB. Asserts the success status and
  the modal both render after submit.

If you change the hero copy, the JSON-LD shape, or the form field names,
update the specs in the same PR.
