/**
 * discountEngine.js
 *
 * Pure discount calculation logic. No UI, no side effects.
 * All functions take plain objects and return plain objects.
 *
 * Data shapes:
 *
 * DiscountRule {
 *   ruleId:    string       — e.g. "RULE-01"
 *   scope:     "brand" | "platform" | "cart"
 *   appliesTo: string       — e.g. "Natura Casa", "Amazon India" ("" for cart rules)
 *   type:      "percentage" | "flat"
 *   value:     number       — percentage as integer (15 = 15%), flat in rupees
 *   stackable: boolean
 *   minCartValue: number    — cart rules only: minimum item-level subtotal (Rs.)
 *                             required for the rule to trigger (inclusive)
 * }
 *
 * CartItem {
 *   itemId:    string       — e.g. "ITEM-01"
 *   product:   string
 *   brand:     string
 *   platform:  string
 *   basePrice: number       — in rupees
 * }
 *
 * DiscountResult {
 *   itemId:        string
 *   product:       string
 *   brand:         string
 *   platform:      string
 *   basePrice:     number
 *   finalPrice:    number
 *   totalDiscount: number
 *   appliedRules:  string[]
 *   skippedRules:  string[]
 *   reasoning:     string   — customer-readable explanation
 * }
 *
 * CartDiscountResult (null when no cart rule triggered) {
 *   appliedRules: string[]  — rule ids applied at cart level
 *   skippedRules: string[]  — eligible non-stackable rules that lost the selection
 *   amount:       number    — total rupees saved at cart level (>= 0)
 *   reasoning:    string    — customer-readable explanation
 * }
 *
 * CartResult {
 *   items:        DiscountResult[]     — item-level results (unchanged)
 *   subtotal:     number               — sum of item-level final prices
 *   cartDiscount: CartDiscountResult | null
 *   finalTotal:   number               — subtotal - cartDiscount.amount (never < 0)
 * }
 *
 * Rounding convention (used everywhere): rupee amounts are rounded to the
 * nearest whole rupee with Math.round (half rounds up), applied to each
 * discount amount as it is calculated. Final prices are then plain integer
 * subtraction, so displayed numbers always add up exactly.
 */

/**
 * Returns true if the rule applies to this cart item.
 */
export function ruleMatchesItem(item, rule) {
  // Cart-level rules never apply to individual items
  if (rule.scope === 'cart') return false
  const normalise = (s) => s.trim().toLowerCase()
  if (rule.scope === 'brand') {
    return normalise(item.brand) === normalise(rule.appliesTo)
  }
  if (rule.scope === 'platform') {
    return normalise(item.platform) === normalise(rule.appliesTo)
  }
  return false
}

/**
 * Calculates the rupee discount a rule gives on a given price.
 * Uses the provided price, not the original base price — important for stacking.
 */
export function calculateDiscountAmount(price, rule) {
  if (rule.type === 'percentage') {
    return Math.round(price * rule.value / 100)
  }
  if (rule.type === 'flat') {
    return rule.value
  }
  return 0
}

/**
 * Builds the customer-facing reasoning string for an applied rule.
 */
function ruleToReasoning(rule) {
  const scopeLabel = rule.scope === 'brand' ? 'Brand' : 'Platform'
  if (rule.type === 'percentage') {
    return `${scopeLabel} offer: ${rule.value}% off`
  }
  if (rule.type === 'flat') {
    return `${scopeLabel} offer: Rs.${rule.value} off`
  }
  return `${scopeLabel} offer applied`
}

/**
 * Applies the active discount rules to a single cart item.
 * Returns a DiscountResult.
 *
 * Logic:
 *   1. Find all rules that match this item.
 *   2. Among non-stackable rules, pick the one giving the largest discount.
 *   3. Apply any stackable rules on top of that price.
 *   4. Build the reasoning string from what was applied.
 */
export function applyDiscounts(item, rules) {
  // Item-level logic only ever sees brand/platform rules that match this item
  const matchingRules = rules.filter((r) => ruleMatchesItem(item, r))

  // No rules match — return base price with explanation
  if (matchingRules.length === 0) {
    return {
      itemId: item.itemId,
      product: item.product,
      brand: item.brand,
      platform: item.platform,
      basePrice: item.basePrice,
      finalPrice: item.basePrice,
      totalDiscount: 0,
      appliedRules: [],
      skippedRules: [],
      reasoning: 'No offers available',
    }
  }

  const nonStackable = matchingRules.filter((r) => !r.stackable)
  const stackable = matchingRules.filter((r) => r.stackable)

  // Pick the non-stackable rule that gives the largest saving
  let winner = null
  let skipped = []

  if (nonStackable.length > 0) {
    const sorted = [...nonStackable].sort(
      (a, b) =>
        calculateDiscountAmount(item.basePrice, b) -
        calculateDiscountAmount(item.basePrice, a)
    )
    winner = sorted[0]
    skipped = sorted.slice(1)
  }

  // Apply winner first, then stack on top
  let price = item.basePrice
  const appliedRules = []
  const reasoningParts = []

  if (winner) {
    price -= calculateDiscountAmount(price, winner)
    appliedRules.push(winner.ruleId)
    reasoningParts.push(ruleToReasoning(winner))
  }

  for (const rule of stackable) {
    price -= calculateDiscountAmount(price, rule)
    appliedRules.push(rule.ruleId)
    reasoningParts.push(ruleToReasoning(rule))
  }

  const finalPrice = Math.round(price)

  return {
    itemId: item.itemId,
    product: item.product,
    brand: item.brand,
    platform: item.platform,
    basePrice: item.basePrice,
    finalPrice,
    totalDiscount: item.basePrice - finalPrice,
    appliedRules,
    skippedRules: skipped.map((r) => r.ruleId),
    reasoning: reasoningParts.join(' + '),
  }
}

/**
 * Runs applyDiscounts across every item in the cart.
 * Returns an array of DiscountResult objects.
 */
export function processCart(cartItems, rules) {
  return cartItems.map((item) => applyDiscounts(item, rules))
}

/**
 * Builds the customer-facing reasoning string for an applied cart rule.
 */
function cartRuleToReasoning(rule) {
  const offer =
    rule.type === 'percentage' ? `${rule.value}% off` : `Rs.${rule.value} off`
  return `Cart offer: ${offer} on orders of Rs.${rule.minCartValue.toLocaleString('en-IN')}+`
}

/**
 * Applies cart-level rules to the item-level subtotal.
 *
 * Selection policy (mirrors the item-level policy so behaviour is predictable):
 *   1. A cart rule is ELIGIBLE only if subtotal >= rule.minCartValue
 *      (equal to the threshold qualifies). Eligibility is always judged on the
 *      item-level subtotal, never on a partly-discounted running total.
 *   2. Among eligible NON-stackable rules, exactly ONE is applied: the one
 *      with the largest rupee saving on the subtotal. Ties go to the rule that
 *      appears first in the rules file. The others are reported as skipped.
 *   3. Eligible STACKABLE rules then apply on top, in file order, each on the
 *      running total.
 *   4. Every discount is clamped to [0, running total], so the cart discount
 *      can never be negative and the final total can never go below zero.
 *
 * Returns a CartDiscountResult, or null if no cart rule triggered.
 */
export function applyCartDiscounts(subtotal, rules) {
  const eligible = rules.filter(
    (r) => r.scope === 'cart' && subtotal >= (r.minCartValue ?? 0)
  )
  if (eligible.length === 0) return null

  const clampedAmount = (price, rule) =>
    Math.min(Math.max(0, calculateDiscountAmount(price, rule)), price)

  const nonStackable = eligible.filter((r) => !r.stackable)
  const stackable = eligible.filter((r) => r.stackable)

  // Array.prototype.sort is stable, so ties keep file order
  const ranked = [...nonStackable].sort(
    (a, b) => clampedAmount(subtotal, b) - clampedAmount(subtotal, a)
  )
  const winner = ranked[0] ?? null
  const skipped = ranked.slice(1)

  let price = subtotal
  const appliedRules = []
  const reasoningParts = []

  for (const rule of [...(winner ? [winner] : []), ...stackable]) {
    const amount = clampedAmount(price, rule)
    price -= amount
    appliedRules.push(rule.ruleId)
    reasoningParts.push(cartRuleToReasoning(rule))
  }

  const amount = subtotal - price
  // A rule that qualifies but saves nothing (e.g. empty-value edge case) is not shown
  if (amount <= 0) return null

  return {
    appliedRules,
    skippedRules: skipped.map((r) => r.ruleId),
    amount,
    reasoning: reasoningParts.join(' + '),
  }
}

/**
 * Full pipeline: item-level discounts first, then cart-level discounts on the
 * resulting subtotal. Returns a CartResult.
 */
export function calculateCart(cartItems, rules) {
  const items = processCart(cartItems, rules)
  const subtotal = cartTotal(items)
  const cartDiscount = applyCartDiscounts(subtotal, rules)
  const finalTotal = Math.max(0, subtotal - (cartDiscount ? cartDiscount.amount : 0))
  return { items, subtotal, cartDiscount, finalTotal }
}

/**
 * Sums the final prices across all results.
 */
export function cartTotal(results) {
  return results.reduce((sum, r) => sum + r.finalPrice, 0)
}
