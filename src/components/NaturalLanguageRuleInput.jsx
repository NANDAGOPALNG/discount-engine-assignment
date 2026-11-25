/**
 * NaturalLanguageRuleInput.jsx
 *
 * Lets the user describe a discount in plain English. Flow:
 *   describe → Parse (server-side LLM) → independent validation → preview
 *   → Confirm (rule is added by the parent) or Discard (nothing changes).
 *
 * Nothing is added to the active rules until the user presses Confirm.
 */

import { useRef, useState } from 'react'
import { requestRuleParse } from '../services/parseRuleApi.js'
import { validateRuleCandidate } from '../engine/ruleValidator.js'

const EXAMPLES = [
  '20% off for Natura Casa brand, stackable with other offers',
  'Rs.100 flat discount on all Flipkart items',
  '10% off if cart value is more than Rs.5,000',
]

const MAX_LENGTH = 500

const S = {
  textarea: {
    width: '100%', boxSizing: 'border-box', minHeight: 64, padding: '0.6rem 0.7rem',
    border: '1px solid #CECECE', borderRadius: 4, fontSize: 13, fontFamily: 'Arial, sans-serif',
    color: '#131A48', resize: 'vertical',
  },
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.6rem', marginTop: '0.6rem' },
  btn: {
    background: '#FF5800', color: '#fff', border: 'none', borderRadius: 4, padding: '0.55rem 1.4rem',
    fontSize: 12, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em', textTransform: 'uppercase',
  },
  btnBusy: {
    background: '#CECECE', color: '#fff', border: 'none', borderRadius: 4, padding: '0.55rem 1.4rem',
    fontSize: 12, fontWeight: 700, cursor: 'wait', letterSpacing: '0.04em', textTransform: 'uppercase',
  },
  btnGhost: {
    background: '#fff', color: '#131A48', border: '1px solid #131A48', borderRadius: 4, padding: '0.55rem 1.4rem',
    fontSize: 12, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em', textTransform: 'uppercase',
  },
  example: {
    background: 'none', border: 'none', padding: 0, color: '#FF5800', fontSize: 11,
    cursor: 'pointer', textDecoration: 'underline', textAlign: 'left',
  },
  error: {
    marginTop: '0.6rem', padding: '0.6rem 0.8rem', background: '#fdf1ee', border: '1px solid #f0b8a5',
    borderRadius: 4, color: '#8a2a0c', fontSize: 12,
  },
  warn: {
    marginTop: '0.6rem', padding: '0.5rem 0.8rem', background: '#fff8e6', border: '1px solid #f1d48a',
    borderRadius: 4, color: '#6b5200', fontSize: 12,
  },
  preview: { marginTop: '0.8rem', border: '1px solid #131A48', borderRadius: 6, overflow: 'hidden' },
  previewHead: {
    background: '#131A48', color: '#fff', padding: '6px 12px', fontSize: 11, fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.05em',
  },
  previewBody: { padding: '0.5rem 0.9rem', background: '#fff' },
  previewRow: {
    display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '5px 0',
    borderBottom: '1px solid #f0f0f0', fontSize: 13, color: '#131A48',
  },
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)
const rs = (n) => `Rs.${n.toLocaleString('en-IN')}`

function previewRows(rule) {
  const rows = [['Scope', cap(rule.scope)]]
  rows.push(['Applies to', rule.scope === 'cart' ? 'Entire cart' : rule.appliesTo])
  rows.push(['Discount type', cap(rule.type)])
  rows.push(['Discount value', rule.type === 'percentage' ? `${rule.value}%` : rs(rule.value)])
  if (rule.scope === 'cart') rows.push(['Minimum cart value', rs(rule.minCartValue)])
  rows.push(['Stackable', rule.stackable ? 'Yes' : 'No'])
  return rows
}

export default function NaturalLanguageRuleInput({ cartItems, onConfirm }) {
  const [text, setText] = useState('')
  const [phase, setPhase] = useState('idle') // idle | loading | preview
  const [error, setError] = useState('')
  const [clarification, setClarification] = useState('')
  const [pending, setPending] = useState(null) // validated rule awaiting confirmation
  const requestId = useRef(0) // ignores responses that arrive after discard/edit

  const loading = phase === 'loading'

  function reset() {
    requestId.current += 1
    setPhase('idle')
    setError('')
    setClarification('')
    setPending(null)
  }

  function handleChange(e) {
    setText(e.target.value)
    // Editing the description invalidates any preview or message shown for the old text
    if (phase !== 'idle' || error || clarification) reset()
  }

  async function handleParse() {
    if (loading) return
    const description = text.trim()
    setError('')
    setClarification('')
    setPending(null)

    if (description === '') {
      setPhase('idle')
      setError('Please describe the discount you want to add, e.g. "10% off for Nordic Basics".')
      return
    }

    const myId = ++requestId.current
    setPhase('loading')
    try {
      const result = await requestRuleParse(description)
      if (myId !== requestId.current) return // discarded or edited meanwhile

      if (result.status === 'unresolvable') {
        setPhase('idle')
        setClarification(result.clarification)
        return
      }

      // Never trust the LLM: validate independently before offering a preview
      const { valid, errors, rule } = validateRuleCandidate(result.rule)
      if (!valid) {
        setPhase('idle')
        setError(`That rule can't be added: ${errors.join(' ')}`)
        return
      }
      setPending(rule)
      setPhase('preview')
    } catch (err) {
      if (myId !== requestId.current) return
      setPhase('idle')
      setError(err.message || 'Something went wrong. Please try again.')
    }
  }

  function handleConfirm() {
    if (!pending) return
    onConfirm(pending)
    setText('')
    reset()
  }

  // Non-blocking hint: a brand/platform that no cart item has would change nothing
  let warning = ''
  if (pending && pending.scope !== 'cart' && cartItems.length > 0) {
    const key = pending.scope // 'brand' | 'platform'
    const target = pending.appliesTo.trim().toLowerCase()
    if (!cartItems.some((i) => i[key].trim().toLowerCase() === target)) {
      warning = `No item in the current cart has the ${key} "${pending.appliesTo}", so this rule won't change any prices right now.`
    }
  }

  return (
    <div>
      <textarea
        style={S.textarea}
        value={text}
        maxLength={MAX_LENGTH}
        onChange={handleChange}
        placeholder='Describe a discount, e.g. "20% off for Natura Casa brand, stackable with other offers"'
        disabled={loading}
        aria-label="Describe a discount rule in plain English"
      />

      <div style={S.row}>
        <button style={loading ? S.btnBusy : S.btn} onClick={handleParse} disabled={loading}>
          {loading ? 'Parsing…' : 'Parse Rule'}
        </button>
        {loading && <span style={{ fontSize: 12, color: '#888' }}>Asking the AI to read your description…</span>}
      </div>

      {!loading && phase !== 'preview' && (
        <div style={{ marginTop: '0.6rem', fontSize: 11, color: '#888' }}>
          Try:{' '}
          {EXAMPLES.map((ex, i) => (
            <span key={ex}>
              <button style={S.example} onClick={() => { setText(ex); reset() }}>{ex}</button>
              {i < EXAMPLES.length - 1 ? ' · ' : ''}
            </span>
          ))}
        </div>
      )}

      {error && <div style={S.error} role="alert">{error}</div>}
      {clarification && (
        <div style={S.warn} role="status">
          <strong>Need a bit more detail.</strong> {clarification}
        </div>
      )}

      {phase === 'preview' && pending && (
        <div style={S.preview}>
          <div style={S.previewHead}>Review parsed rule — not active yet</div>
          <div style={S.previewBody}>
            {previewRows(pending).map(([label, value]) => (
              <div key={label} style={S.previewRow}>
                <span style={{ color: '#888' }}>{label}</span>
                <span style={{ fontWeight: 700 }}>{value}</span>
              </div>
            ))}
            {warning && <div style={S.warn}>{warning}</div>}
            <div style={{ ...S.row, justifyContent: 'flex-end' }}>
              <button style={S.btnGhost} onClick={reset}>Discard</button>
              <button style={S.btn} onClick={handleConfirm}>Confirm &amp; Add Rule</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
