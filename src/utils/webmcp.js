const CALLBACK_ENDPOINT = '/api/callback'

function clean(value) {
  return typeof value === 'string' ? value.trim() : ''
}

async function requestCallback(input = {}) {
  const payload = {
    email: clean(input.email).toLowerCase(),
    phone: clean(input.phone),
    company: clean(input.company),
    role: clean(input.role),
    summary: clean(input.summary),
    website: clean(input.website),
  }

  const response = await fetch(CALLBACK_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const body = await response.json().catch(() => ({}))

  if (!response.ok || body.ok === false) {
    throw new Error(body.message || 'Unable to submit the callback request.')
  }

  return body?.ok === true ? body : { ok: true }
}

export function registerWebMcpTools() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return

  const modelContext = navigator.modelContext
  if (!modelContext || typeof modelContext.provideContext !== 'function') return
  if (window.__vedryxWebMcpRegistered) return

  window.__vedryxWebMcpRegistered = true

  try {
    modelContext.provideContext({
      tools: [
        {
          name: 'request_callback',
          description:
            'Request a Vedryx callback for a company that wants to hire dedicated remote developers.',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['email', 'phone', 'role', 'summary'],
            properties: {
              email: {
                type: 'string',
                format: 'email',
                description: 'Work email for the hiring contact.',
              },
              phone: {
                type: 'string',
                description: 'Phone number for the callback.',
              },
              company: {
                type: 'string',
                description: 'Company name, if available.',
              },
              role: {
                type: 'string',
                description: 'Developer role or capability needed.',
              },
              summary: {
                type: 'string',
                description: 'Brief hiring requirement or project context.',
              },
              website: {
                type: 'string',
                description: 'Leave blank. Honeypot field for spam prevention.',
              },
            },
          },
          execute: requestCallback,
        },
      ],
    })
  } catch (error) {
    window.__vedryxWebMcpRegistered = false
    console.warn('WebMCP registration failed', error)
  }
}
