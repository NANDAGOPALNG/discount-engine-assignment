/**
 * pdfCartImport.js
 *
 * Reads a PDF file in the browser with PDF.js, extracts positioned text, and
 * hands it to the pure parser (src/engine/pdfCartParser.js).
 *
 *   importCartFromPdf(file) → { data: CartItem[], errors: string[] }
 *
 * Never throws for bad input: every failure comes back as { data: [], errors }.
 * PDF.js is loaded lazily, so it adds nothing to the initial page load.
 */

import { parseCartFromPages, NO_TEXT_MESSAGE } from '../engine/pdfCartParser.js'

const MAX_BYTES = 10 * 1024 * 1024
const MAX_PAGES = 20

let pdfjsPromise
async function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const [lib, worker] = await Promise.all([
        import('pdfjs-dist/build/pdf.mjs'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
      ])
      lib.GlobalWorkerOptions.workerSrc = worker.default
      return lib
    })().catch((err) => {
      pdfjsPromise = undefined // allow a retry
      throw err
    })
  }
  return pdfjsPromise
}

/** Library-agnostic: pulls { str, x, y, width, height } fragments out of every page. */
async function readPages(pdfjs, data) {
  const task = pdfjs.getDocument({ data, isEvalSupported: false })
  try {
    const doc = await task.promise
    if (doc.numPages > MAX_PAGES) {
      const err = new Error('too many pages')
      err.code = 'TOO_MANY_PAGES'
      throw err
    }
    const pages = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      pages.push({
        items: content.items
          .filter((it) => typeof it.str === 'string')
          .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width, height: it.height })),
      })
    }
    return pages
  } finally {
    await task.destroy() // releases the worker and parsed document
  }
}

function describeFailure(err) {
  if (err?.name === 'PasswordException') return 'This PDF is password-protected. Remove the password and try again.'
  if (err?.name === 'InvalidPDFException' || err?.name === 'FormatError') {
    return 'This file is not a valid PDF, or it is corrupted.'
  }
  if (err?.code === 'TOO_MANY_PAGES') return `This PDF has more than ${MAX_PAGES} pages, which is more than a cart should need.`
  return 'The PDF could not be read. Please check the file and try again.'
}

/**
 * @param {File|Blob} file
 * @param {{ pdfjs?: object }} [options] — inject a PDF.js build (used by tests)
 */
export async function importCartFromPdf(file, options = {}) {
  const fail = (message) => ({ data: [], errors: [message] })

  if (!file) return fail('No file was selected.')
  if (file.size === 0) return fail('The selected file is empty.')
  if (file.size > MAX_BYTES) return fail('The PDF is larger than 10 MB.')

  let pages
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const pdfjs = options.pdfjs ?? (await loadPdfJs())
    pages = await readPages(pdfjs, bytes)
  } catch (err) {
    return fail(describeFailure(err))
  }

  return parseCartFromPages(pages)
}

export { NO_TEXT_MESSAGE }
