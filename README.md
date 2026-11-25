# Opptra Discount Engine

A small web app that calculates retail discounts for a shopping cart. Rules and carts can be loaded from CSV (and carts from PDF), new rules can be written in plain English and are parsed by an LLM, and every price shown to the customer comes with a plain-language explanation of which offers were applied.

Built for the **Opptra FDE Intern assignment**.

**Live demo:** [https://YOUR-DEPLOYMENT-URL.vercel.ap](https://discount-engine-assignment-orcin.vercel.app/)p  <!-- replace with your deployed URL before submitting -->

![Discount Engine screenshot](docs/screenshot.png)

---

## Features

| Area | What it does |
|---|---|
| **Item-level discounts** | Brand and platform rules, percentage or flat. The best **non-stackable** rule (largest saving in rupees) is applied, then any **stackable** rules are applied on top. |
| **Cart-level discounts** | Rules with a minimum cart value (e.g. 10% off orders of Rs.4,000+), evaluated *after* all item discounts, on the item-level subtotal. Shown as a separate line in the summary. |
| **CSV upload** | Discount rules and cart items, with row-level validation and clear error messages. |
| **PDF cart upload** | Upload a text-based PDF table (`Product / Brand / Platform / Base Price`). Extracted in the browser with PDF.js; the cart is only replaced if the whole PDF validates. |
| **Natural-language rules** | Type a rule such as *"20% off for Natura Casa brand, stackable with other offers"*. Gemini converts it to a structured rule, which is independently validated, previewed, and added only when you confirm it. |
| **Explanations** | Every item shows what was applied (e.g. `Brand offer: Rs.150 off + Platform offer: 10% off`), or `No offers available`. |

---

## Quick start

**Requirements:** Node.js 18 or newer.

```bash
npm install
cp .env.example .env      # then add your GEMINI_API_KEY (only needed for natural-language rules)
npm run dev
```

Open <http://localhost:5173>.

CSV upload, PDF upload and all discount calculations work **without** an API key. Only the natural-language rule box needs `GEMINI_API_KEY`.

### Try it with the sample data

1. Upload `sample-data/rules.csv` under **Discount Rules**.
2. Upload `sample-data/cart.csv` (or `sample-data/cart.pdf`) under **Cart Items**.
3. Click **Calculate Discounts**.

Expected result:

| Item | Product | Base Price | Final Price | Offer applied |
|---|---|---|---|---|
| ITEM-01 | Cushion Cover | Rs.1,299 | **Rs.1,104** | Platform offer: 15% off (beats Rs.150 flat) |
| ITEM-02 | Bed Sheet Set | Rs.849 | **Rs.629** | Brand offer: Rs.150 off + Platform offer: 10% off |
| ITEM-03 | Wall Shelf | Rs.599 | **Rs.509** | Platform offer: 15% off |
| ITEM-04 | Ceramic Vase | Rs.2,499 | **Rs.2,499** | No offers available |
| ITEM-05 | Cutting Board | Rs.449 | **Rs.382** | Platform offer: 15% off |
| ITEM-06 | Desk Organiser | Rs.899 | **Rs.809** | Platform offer: 10% off |

| Cart summary | |
|---|---|
| Subtotal after item offers | Rs.5,932 |
| `RULE-04` · Cart offer: 10% off on orders of Rs.4,000+ | You save **Rs.593** |
| **Final cart total** | **Rs.5,339** |

---

## Input formats

### `rules.csv`

| Column | Type | Notes | Example |
|---|---|---|---|
| `rule_id` | string | Required | `RULE-01` |
| `scope` | `brand` \| `platform` \| `cart` | Required | `platform` |
| `applies_to` | string | Required for `brand` / `platform`; **leave blank for `cart`** | `Amazon India` |
| `type` | `percentage` \| `flat` | Required | `percentage` |
| `value` | positive number | Percent (15 = 15%) or rupees | `15` |
| `stackable` | `true` \| `false` | Required | `false` |
| `min_cart_value` | number ≥ 0 | **Required for `cart` rules only**; ignored otherwise. The column may be omitted if there are no cart rules. | `4000` |

```csv
rule_id,scope,applies_to,type,value,stackable,min_cart_value
RULE-01,platform,Amazon India,percentage,15,false,
RULE-02,brand,Natura Casa,flat,150,false,
RULE-03,platform,Flipkart,percentage,10,true,
RULE-04,cart,,percentage,10,false,4000
```

### `cart.csv`

| Column | Type | Example |
|---|---|---|
| `item_id` | string | `ITEM-01` |
| `product` | string | `Cushion Cover` |
| `brand` | string | `Natura Casa` |
| `platform` | string | `Amazon India` |
| `base_price` | positive number | `1299` |

### Cart PDF

A **text-based** PDF containing a table with the columns **Product | Brand | Platform | Base Price**. Prices may look like `Rs.1,299`, `Rs. 1299`, `₹1,299` or `1,299`. See `sample-data/cart.pdf`.

- The header row is located automatically; column positions are read from it, so a blank cell stays blank instead of shifting values.
- Pipe-delimited text lines (`Cushion Cover | Natura Casa | Amazon India | Rs.1,299`) are also understood.
- Repeated headers on later pages and `Total` / page-number lines are ignored.
- Item IDs are generated as `ITEM-01`, `ITEM-02`, …
- **No OCR:** scanned or image-only PDFs are rejected with an explanatory message.
- Limits: 10 MB, 20 pages.

---

## How discounts are calculated

### 1. Item level

For each cart item, rules whose `brand` / `platform` matches (case-insensitive, trimmed) are collected.

1. Among the matching **non-stackable** rules, the one giving the **largest rupee saving on the base price** wins; the others are reported as skipped. Ties go to the rule listed first.
2. The winner is applied, then every matching **stackable** rule is applied in turn on the *remaining* price.
3. Each discount is **capped at the remaining price**, so an item can never go below Rs.0 and total discounts never exceed the base price. If a flat discount had to be limited, the explanation says so.

### 2. Cart level

After every item has its final price, the **subtotal** is the sum of those final prices.

- A cart rule is **eligible** when `subtotal >= min_cart_value` (equal to the threshold qualifies). Eligibility is always judged on the item-level subtotal.
- Among eligible **non-stackable** cart rules, **exactly one** is applied: the largest saving on the subtotal (ties → first in file). The rest are skipped, so multiple non-stackable cart discounts can never double up.
- Eligible **stackable** cart rules then apply on top, in file order.
- The cart discount is capped at the running total (never negative, total never below Rs.0).
- If no cart rule is eligible, no cart offer row is shown.
- Cart discounts are **never** applied to individual items; they appear as their own line.

### 3. Rounding

Each discount amount is rounded to the nearest whole rupee with `Math.round` (halves round up) at the moment it is calculated, and prices are then plain integer subtraction, so the displayed numbers always add up exactly. Example: 10% of Rs.5,932 = 593.2 → **Rs.593**.

---

## Natural-language rules

Describe a discount in plain English, for example:

- `20% off for Natura Casa brand, stackable with other offers`
- `Rs.100 flat discount on all Flipkart items`
- `10% off if cart value is more than Rs.5,000`

**Workflow:** *Parse Rule* → review the preview → **Confirm** (rule is added and the cart recalculates automatically) or **Discard** (nothing changes). Nothing is added to the active rules before you confirm.

- Confirmed rules appear in the rules table with source **Custom** and get a unique ID (`NL-01`, `NL-02`, …).
- Rules uploaded via CSV and rules added in plain English are stored separately, so **re-uploading `rules.csv` does not remove confirmed rules**.
- Ambiguous input ("Give a discount for big orders") returns a clarification asking for the missing value/threshold. Invalid input ("200% off") is rejected.
- If you describe a brand/platform that isn't in the current cart, you get a warning in the preview (the rule would not change any price).

### Architecture

```
Browser ──POST /api/parse-rule──▶ server/parseRule.js ──▶ Gemini API
   │        { description }          (key lives here only)    (structured JSON output)
   │◀───── { status, rule | clarification } ─────────────────────┘
   ▼
src/engine/ruleValidator.js   ← the LLM output is NOT trusted; validated again in the browser
   ▼
Preview → user clicks Confirm → added to active rules → cart recalculated
```

- **Structured output:** the request uses Gemini's JSON mode with a response schema, so the model returns data, not prose that has to be scraped.
- **Server-side only key:** `GEMINI_API_KEY` is read from the server environment and is never sent to the browser or returned in responses. It must **not** use a `VITE_` prefix.
- **Independent validation** (`ruleValidator.js`): scope must be brand / platform / cart; type percentage / flat; value a positive number; percentages ≤ 100; `stackable` a real boolean; brand/platform rules need `appliesTo`; cart rules need a valid `minCartValue` and do not need `appliesTo`. Problems are shown as readable messages and invalid rules cannot be added.
- **Failure handling:** empty or oversized input (max 500 characters), timeouts (15 s), rate limits, upstream errors, malformed or empty model output, and network failures all produce a clear message in the UI.

### API

`POST /api/parse-rule`

```jsonc
// request
{ "description": "10% off if cart value is more than Rs.5,000" }

// 200 — parsed
{ "status": "parsed",
  "rule": { "scope": "cart", "appliesTo": null, "type": "percentage",
            "value": 10, "stackable": false, "minCartValue": 5000 } }

// 200 — needs clarification
{ "status": "unresolvable", "clarification": "Please specify the discount value and the minimum order value." }

// 4xx / 5xx
{ "error": "human-readable message" }
```

| Status | Meaning |
|---|---|
| 400 | Empty or too-long description |
| 405 | Method other than POST |
| 429 | AI service rate-limited |
| 500 | `GEMINI_API_KEY` not configured on the server |
| 502 | Upstream error, or malformed / empty model response |
| 504 | AI service timed out (15 s) |

Test it locally:

```bash
curl -X POST http://localhost:5173/api/parse-rule \
  -H 'Content-Type: application/json' \
  -d '{"description":"Rs.100 flat discount on all Flipkart items"}'
```

---

## Configuration

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | For natural-language rules | Google Gemini API key from <https://aistudio.google.com/apikey>. Server-side only. |
| `GEMINI_MODEL` | No | Overrides the Gemini model id (default `gemini-3.6-flash`). |

For local development copy `.env.example` to `.env` (git-ignored). The Vite dev server serves `/api/parse-rule` from the same handler used in production, so no extra tooling is needed.

---

## Deployment (Vercel)

1. Import the repository in Vercel (framework preset **Vite**; build command `npm run build`, output directory `dist`).
2. Under **Project Settings → Environment Variables**, add `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`) for Production and Preview.
3. Deploy (or redeploy after adding variables). `api/parse-rule.js` is deployed automatically as a serverless function.
4. Put the live URL at the top of this README.

> The app is a static frontend plus **one** serverless function. Hosts that only serve static files will run everything except natural-language rules, because `/api/parse-rule` will not exist there.

---

## Project structure

```
api/
  parse-rule.js            Vercel serverless adapter for the parsing endpoint
server/
  parseRule.js             Gemini call, structured output, timeout & error mapping (no UI, no engine code)
src/
  engine/                  Pure logic — no React, no network
    discountEngine.js        item-level + cart-level calculation
    csvParser.js             rules.csv / cart.csv → typed objects, with validation
    ruleValidator.js         independent validation of LLM-produced rules, rule-ID generation
    pdfCartParser.js         positioned PDF text → validated CartItems
  services/
    parseRuleApi.js          browser client for /api/parse-rule
    pdfCartImport.js         reads a PDF with PDF.js (lazy-loaded) and calls the parser
  components/
    CsvUploader.jsx          CSV upload area
    PdfUploader.jsx          PDF upload area
    NaturalLanguageRuleInput.jsx   describe → parse → preview → confirm / discard
    DataTable.jsx            reusable table
    ErrorBanner.jsx          error list
  App.jsx                  state (CSV rules, custom rules, cart, results) and layout
sample-data/
  rules.csv  cart.csv  cart.pdf
vite.config.js             Vite config + dev-only middleware for /api/parse-rule
```

The discount engine takes plain objects and returns plain objects, so it is independent of React and of the LLM and PDF layers.

**Stack:** React 18, Vite 5, PapaParse (CSV), PDF.js (`pdfjs-dist`), Google Gemini REST API. No database.

---

## Manual test checklist

There is no automated test suite in this repository; behaviour was verified manually and with throw-away scripts against the engine and parsers. To re-check by hand:

| # | Scenario | How | Expected |
|---|---|---|---|
| 1 | Sample data | Upload sample rules + cart, Calculate | Items 1,104 / 629 / 509 / 2,499 / 382 / 809; subtotal 5,932; cart saving 593; total 5,339 |
| 2 | Just below threshold | Set RULE-04 `min_cart_value` to `5933` | No cart offer row; "Cart Total" Rs.5,932 |
| 3 | Equal to threshold | Set it to `5932` | Cart offer applies (saves 593) |
| 4 | No cart rule | Delete the RULE-04 row | Same as #2 |
| 5 | Multiple cart rules | Add `RULE-05,cart,,flat,700,false,5000` and `RULE-06,cart,,percentage,5,false,1000` | Only RULE-05 applies (saves 700); total 5,232 |
| 6 | Discount can't go negative | Brand flat rule of 500 on a Rs.100 item | Item price Rs.0, not negative |
| 7 | Cart PDF | Upload `sample-data/cart.pdf` | Six items, identical results to the CSV cart |
| 8 | Bad PDF | PDF with a blank brand, a bad price, a scanned image, or a non-PDF file | Error listed; **existing cart and results unchanged** |
| 9 | NL rule confirm | Parse `20% off for Natura Casa brand, stackable` → Confirm | Rule `NL-01` appears as *Custom*, results recalculate |
| 10 | NL rule discard | Parse a rule → Discard | Rules and results unchanged |
| 11 | NL invalid input | `200% off all products`, `Give a discount for big orders`, empty input | Rejected / clarification / blocked with a message |
| 12 | Rules preserved | Confirm an NL rule, then re-upload `rules.csv` or replace the cart | Custom rule is still active |

---

## Assumptions and limitations

- **Currency** is Indian rupees, handled as whole numbers (prices from CSV/PDF are rounded to whole rupees).
- **Matching** of brand/platform names is case-insensitive but otherwise exact; there is no fuzzy matching.
- **Stackable cart rules** are supported (an extension of the stackable item-level behaviour); if you never want cart rules to stack, mark them `false`.
- **Custom rules are held in memory** only: reloading the page clears them, and there is no button to remove an individual rule.
- **PDF import** supports text-based tables only (no OCR). Rows that wrap over several lines, or tables without the four expected column headers, are rejected rather than guessed. PDF.js 6 requires a recent browser, and its code is downloaded only when a PDF is selected.
- **Natural-language parsing** depends on the Gemini API being reachable and configured; everything else works offline of it.
