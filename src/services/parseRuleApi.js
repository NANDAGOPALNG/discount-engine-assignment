/**
 * parseRuleApi.js
 *
 * Browser-side client for POST /api/parse-rule. Contains no secrets.
 * Resolves to { status: 'parsed', rule } | { status: 'unresolvable', clarification }
 * and throws an Error with a user-readable message on any failure.
 */
export async function requestRuleParse(description) {
  let response
  try {
    response = await fetch('/api/parse-rule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description }),
    })
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.')
  }

  let data
  try {
    data = await response.json()
  } catch {
    throw new Error('The server returned an unexpected response. Is the API running?')
  }

  if (!response.ok) {
    throw new Error(data?.error || `Request failed (${response.status}).`)
  }
  if (data?.status !== 'parsed' && data?.status !== 'unresolvable') {
    throw new Error('The server returned data in an unexpected format.')
  }
  return data
}
