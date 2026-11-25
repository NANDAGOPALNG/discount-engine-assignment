/**
 * pdfCartParser.js
 *
 * Pure logic (no PDF library, no React, no network) that turns the positioned
 * text extracted from a PDF into CartItem objects — the same shape produced by
 * csvParser.parseCartCSV:
 *   { itemId, product, brand, platform, basePrice }   (basePrice = whole rupees)
 *
 * Input — pages: [{ items: [{ str, x, y, width, height }] }]
 *   One entry per page; items are text fragments with their position
 *   (x grows to the right, y grows upwards, as in PDF coordinates).
 *
 * Expected PDF content: a text-based table with the columns
 *   Product | Brand | Platform | Base Price
 * Two layouts are understood:
 *   1. Visual table — columns are located from the header row's x-positions.
 *   2. Pipe-delimited text — "Cushion Cover | Natura Casa | Amazon India | Rs.1,299"
 *
 * parseCartFromPages(pages) → { data, errors }
 *   All-or-nothing: if ANY problem is found, data is [] and errors explains
 *   what to fix, so a half-read cart can never replace a good one.
 */

const MAX_FIELD_LENGTH = 100
const COLUMN_NAMES = ['product', 'brand', 'platform', 'price']
const COLUMN_LABELS = { product: 'Product', brand: 'Brand', platform: 'Platform', price: 'Base Price' }

export const NO_TEXT_MESSAGE =
  'No text could be extracted from this PDF. It may be a scanned/image-only PDF, which is not supported ' +
  '(there is no OCR). Please upload a text-based PDF, or use the CSV upload instead.'

// Lines that can follow the table but are not item rows
const IGNORABLE_LINE = [
  /^page\s*\d+(\s*(of|\/)\s*\d+)?$/i,
  /^\d+\s*\/\s*\d+$/,
  /^(sub\s*)?total\b/i,
  /^grand\s+total\b/i,
]

// ── Text → lines ────────────────────────────────────────────────

/** Groups a page's text fragments into visual lines, top to bottom, left to right. */
function groupIntoLines(items) {
  const frags = items
    .filter((it) => typeof it.str === 'string' && it.str.trim() !== '')
    .map((it) => {
      const height = it.height || 10
      const width = it.width || it.str.length * height * 0.5 // rough fallback if width is unknown
      return { str: it.str.trim(), x: it.x, y: it.y, width, height }
    })
    .sort((a, b) => b.y - a.y || a.x - b.x)

  const lines = []
  for (const frag of frags) {
    const last = lines[lines.length - 1]
    const tolerance = Math.max(2, frag.height * 0.4)
    if (last && Math.abs(last.y - frag.y) <= tolerance) {
      last.items.push(frag)
    } else {
      lines.push({ y: frag.y, items: [frag] })
    }
  }
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x)
    line.text = line.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim()
  }
  return lines
}

// ── Header detection ────────────────────────────────────────────

function isHeaderText(text) {
  const t = text.toLowerCase()
  return COLUMN_NAMES.every((c) => t.includes(c))
}

/** Reads the column layout from a header line. Returns { mode, columns } or null. */
function readHeader(line) {
  if (!isHeaderText(line.text)) return null

  if (line.text.includes('|')) {
    const cells = splitPipes(line.text).map((c) => c.toLowerCase())
    const order = cells.map((c) => COLUMN_NAMES.find((n) => c.includes(n)) ?? null)
    if (COLUMN_NAMES.every((n) => order.includes(n))) return { mode: 'pipe', order }
    return null
  }

  const columns = []
  for (const name of COLUMN_NAMES) {
    const matches = line.items.filter((i) =>
      name === 'price' ? /base|price/i.test(i.str) : i.str.toLowerCase().includes(name)
    )
    if (matches.length === 0) return null
    const left = Math.min(...matches.map((m) => m.x))
    const right = Math.max(...matches.map((m) => m.x + m.width))
    columns.push({ name, left, right, center: (left + right) / 2 })
  }
  columns.sort((a, b) => a.left - b.left)
  return { mode: 'x', columns }
}

// ── Line → cells ────────────────────────────────────────────────

function splitPipes(text) {
  const cells = text.split('|').map((c) => c.trim())
  if (cells.length > 0 && cells[0] === '') cells.shift() // leading "|"
  if (cells.length > 0 && cells[cells.length - 1] === '') cells.pop() // trailing "|"
  return cells
}

/** Returns { product, brand, platform, price } (strings) or { columnCountError }. */
function lineToCells(line, header) {
  if (header.mode === 'pipe' || (header.mode === 'x' && line.text.includes('|'))) {
    const cells = splitPipes(line.text)
    const order = header.mode === 'pipe' ? header.order : header.columns.map((c) => c.name)
    if (cells.length !== order.length) {
      return { columnCountError: `expected ${order.length} columns but found ${cells.length}` }
    }
    const out = { product: '', brand: '', platform: '', price: '' }
    order.forEach((name, i) => { out[name] = cells[i] })
    return out
  }

  // Visual table: put each fragment in the column whose header it lines up with best.
  // Alignment can be left, centred or right, so compare all three anchors and
  // take the closest — this keeps wide cell text in its own column.
  const out = { product: '', brand: '', platform: '', price: '' }
  for (const item of line.items) {
    const left = item.x
    const right = item.x + item.width
    const center = (left + right) / 2
    let target = header.columns[0]
    let best = Infinity
    for (const col of header.columns) {
      const dist = Math.min(Math.abs(left - col.left), Math.abs(center - col.center), Math.abs(right - col.right))
      if (dist < best) { best = dist; target = col }
    }
    out[target.name] = out[target.name] ? `${out[target.name]} ${item.str}` : item.str
  }
  return out
}

// ── Cell validation ─────────────────────────────────────────────

/** "Rs.1,299" | "Rs. 1299" | "₹1,299" | "INR 1299" | "1,299.00" → number, or null if invalid. */
export function parsePrice(raw) {
  const cleaned = String(raw)
    .trim()
    .replace(/^(?:rs\.?|inr|₹)\s*/i, '')
    .replace(/,/g, '')
    .replace(/\s+/g, '')
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null
  const n = parseFloat(cleaned)
  return Number.isFinite(n) && n > 0 ? n : null
}

function validateRow(cells, rowNum) {
  const label = cells.product ? `Row ${rowNum} (${cells.product.slice(0, 40)})` : `Row ${rowNum}`
  const problems = []

  const missing = ['product', 'brand', 'platform']
    .filter((f) => !cells[f] || cells[f].trim() === '')
    .map((f) => COLUMN_LABELS[f])
  if (!cells.price || cells.price.trim() === '') missing.push(COLUMN_LABELS.price)
  if (missing.length > 0) problems.push(`missing ${missing.join(', ')}`)

  for (const f of ['product', 'brand', 'platform']) {
    if (cells[f] && cells[f].length > MAX_FIELD_LENGTH) problems.push(`${COLUMN_LABELS[f]} is too long`)
  }

  let basePrice = null
  if (cells.price && cells.price.trim() !== '') {
    const price = parsePrice(cells.price)
    if (price === null) problems.push(`Base Price "${cells.price}" is not a valid positive number`)
    else basePrice = Math.round(price) // same whole-rupee convention as the CSV parser
  }

  if (problems.length > 0) return { error: `${label}: ${problems.join('; ')}` }
  return {
    item: {
      product: cells.product.trim(),
      brand: cells.brand.trim(),
      platform: cells.platform.trim(),
      basePrice,
    },
  }
}

// ── Public API ──────────────────────────────────────────────────

export function parseCartFromPages(pages) {
  const hasText = (pages || []).some((p) => (p.items || []).some((i) => typeof i.str === 'string' && i.str.trim() !== ''))
  if (!hasText) return { data: [], errors: [NO_TEXT_MESSAGE] }

  const errors = []
  const items = []
  let header = null
  let rowNum = 0

  for (const page of pages) {
    for (const line of groupIntoLines(page.items || [])) {
      const found = readHeader(line)
      if (found) { header = found; continue } // header (also repeated on later pages)
      if (!header) continue // title / intro text above the table
      if (IGNORABLE_LINE.some((re) => re.test(line.text))) continue

      rowNum += 1
      const cells = lineToCells(line, header)
      if (cells.columnCountError) {
        errors.push(`Row ${rowNum} ("${line.text.slice(0, 60)}"): ${cells.columnCountError}`)
        continue
      }
      const { item, error } = validateRow(cells, rowNum)
      if (error) errors.push(error)
      else items.push(item)
    }
  }

  if (!header) {
    return {
      data: [],
      errors: ['Could not find a table with the columns Product, Brand, Platform and Base Price in this PDF.'],
    }
  }
  if (errors.length > 0) return { data: [], errors }
  if (items.length === 0) {
    return { data: [], errors: ['Found the table header but no item rows below it.'] }
  }

  const width = Math.max(2, String(items.length).length)
  const data = items.map((item, i) => ({
    itemId: `ITEM-${String(i + 1).padStart(width, '0')}`,
    ...item,
  }))
  return { data, errors: [] }
}
