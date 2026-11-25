/**
 * PdfUploader.jsx
 *
 * Upload area for a cart supplied as a PDF table. Reads and validates the PDF
 * (via the pdfCartImport service), then calls:
 *   onLoad(items, fileName)  — only when the PDF produced a fully valid cart
 *   onError(errors)          — otherwise (the caller keeps the existing cart)
 * Styled to match CsvUploader.
 */

import { useRef, useState } from 'react'
import { importCartFromPdf } from '../services/pdfCartImport.js'

export default function PdfUploader({ label, description, onLoad, onError, hasData, fileName }) {
  const inputRef = useRef(null)
  const [loading, setLoading] = useState(false)

  async function handleFile(e) {
    const file = e.target.files[0]
    e.target.value = '' // allow re-selecting the same file
    if (!file || loading) return

    setLoading(true)
    try {
      const { data, errors } = await importCartFromPdf(file)
      if (errors.length > 0 || data.length === 0) {
        onError(errors.length > 0 ? errors : ['No cart items could be read from this PDF.'])
      } else {
        onLoad(data, file.name)
      }
    } catch {
      onError(['Something went wrong while reading the PDF. Please try again.'])
    } finally {
      setLoading(false)
    }
  }

  const borderColor = hasData ? '#1e5c2c' : '#CECECE'
  return (
    <div
      style={{
        border: `2px dashed ${borderColor}`,
        borderRadius: 6,
        padding: '1rem 1.2rem',
        background: hasData ? '#f0faf2' : '#fafafa',
        cursor: loading ? 'wait' : 'pointer',
        transition: 'border-color 0.15s',
      }}
      onClick={() => !loading && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        style={{ display: 'none' }}
        onChange={handleFile}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <span style={{ fontSize: 20 }}>{hasData ? '✅' : '📑'}</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#131A48' }}>{label}</div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
            {loading ? 'Reading PDF…' : hasData ? fileName : description}
          </div>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: loading ? '#888' : hasData ? '#1e5c2c' : '#FF5800',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            {loading ? 'Please wait' : hasData ? 'Change' : 'Upload'}
          </span>
        </div>
      </div>
    </div>
  )
}
