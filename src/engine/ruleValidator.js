/**
 * ruleValidator.js
 *
 * Independent validation for rules that did NOT come from the CSV parser
 * (e.g. produced by an LLM). Pure, no UI, no network. The LLM output is
 * treated as untrusted input: nothing is accepted unless it passes here.
 *
 * validateRuleCandidate(candidate) → { valid, errors, rule }
 *   - errors: human-readable strings (empty when valid)
 *   - rule:   a normalised DiscountRule the engine can use (null when invalid)
 *
 * The resulting rule has exactly the shape used by csvParser/discountEngine:
 *   { ruleId, scope, appliesTo, type, value, stackable, minCartValue? }
 * (minCartValue is present only on cart rules, as in the CSV parser.)
 */

const SCOPES = ['brand', 'platform', 'cart']
const TYPES = ['percentage', 'flat']
const MAX_TEXT_LENGTH = 100

const isFiniteNumber = (n) => typeof n === 'number' && Number.isFinite(n)

export function validateRuleCandidate(candidate) {
  const errors = []

  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { valid: false, errors: ['The parsed rule is missing or not an object.'], rule: null }
  }

  // scope
  const scope = typeof candidate.scope === 'string' ? candidate.scope.trim().toLowerCase() : ''
  if (!SCOPES.includes(scope)) {
    errors.push('Scope must be "brand", "platform" or "cart".')
  }

  // type
  const type = typeof candidate.type === 'string' ? candidate.type.trim().toLowerCase() : ''
  if (!TYPES.includes(type)) {
    errors.push('Discount type must be "percentage" or "flat".')
  }

  // value
  const value = candidate.value
  if (!isFiniteNumber(value) || value <= 0) {
    errors.push('Discount value must be a positive number.')
  } else if (type === 'percentage' && value > 100) {
    errors.push(`A percentage discount cannot exceed 100% (got ${value}%).`)
  }

  // stackable
  if (typeof candidate.stackable !== 'boolean') {
    errors.push('Stackable must be true or false.')
  }

  // appliesTo / minCartValue depend on scope
  let appliesTo = ''
  let minCartValue
  if (scope === 'brand' || scope === 'platform') {
    appliesTo = typeof candidate.appliesTo === 'string' ? candidate.appliesTo.trim() : ''
    if (appliesTo === '') {
      errors.push(`A ${scope} rule must say which ${scope} it applies to.`)
    } else if (appliesTo.length > MAX_TEXT_LENGTH) {
      errors.push(`The ${scope} name is too long (max ${MAX_TEXT_LENGTH} characters).`)
    }
  } else if (scope === 'cart') {
    // Cart rules never need appliesTo — whatever was supplied is discarded.
    if (!isFiniteNumber(candidate.minCartValue) || candidate.minCartValue < 0) {
      errors.push('A cart rule needs a minimum cart value (a number, 0 or more).')
    } else {
      minCartValue = candidate.minCartValue
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, rule: null }
  }

  const rule = {
    ruleId: typeof candidate.ruleId === 'string' ? candidate.ruleId.trim() : '',
    scope,
    appliesTo,
    type,
    value,
    stackable: candidate.stackable,
    ...(scope === 'cart' ? { minCartValue } : {}),
  }
  return { valid: true, errors: [], rule }
}

/**
 * Returns a rule id that is not used by any existing rule (case-insensitive).
 * Format: NL-01, NL-02, … The "NL-" prefix keeps these apart from CSV ids
 * such as RULE-01, so a later CSV upload is very unlikely to collide.
 */
export function generateRuleId(existingRules) {
  const taken = new Set(existingRules.map((r) => String(r.ruleId).trim().toLowerCase()))
  let n = 1
  while (taken.has(`nl-${String(n).padStart(2, '0')}`)) n += 1
  return `NL-${String(n).padStart(2, '0')}`
}
