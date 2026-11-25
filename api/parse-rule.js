/**
 * Vercel serverless function: POST /api/parse-rule
 * Thin adapter around server/parseRule.js. The same handler is used by the
 * Vite dev server (see vite.config.js), so local and deployed behaviour match.
 *
 * Requires the GEMINI_API_KEY environment variable (server-side only).
 */
import { handleParseRule } from '../server/parseRule.js'

export default async function handler(req, res) {
  const { status, json } = await handleParseRule({
    method: req.method,
    body: req.body,
    env: process.env,
  })
  res.setHeader('Cache-Control', 'no-store')
  res.status(status).json(json)
}
