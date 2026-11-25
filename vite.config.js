import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { handleParseRule } from './server/parseRule.js'

/**
 * Dev-only: serves POST /api/parse-rule from the same handler the Vercel
 * function uses, so `npm run dev` needs no extra tooling. Secrets are read
 * from .env on the Node side only — they are never bundled into the client
 * (only VITE_-prefixed vars are, and GEMINI_API_KEY must never use that prefix).
 */
function localApiPlugin(env) {
  return {
    name: 'local-api-parse-rule',
    configureServer(server) {
      server.middlewares.use('/api/parse-rule', (req, res) => {
        let raw = ''
        req.on('data', (chunk) => {
          raw += chunk
          if (raw.length > 10_000) req.destroy()
        })
        req.on('end', async () => {
          let body
          try {
            body = raw ? JSON.parse(raw) : undefined
          } catch {
            body = undefined
          }
          const { status, json } = await handleParseRule({ method: req.method, body, env })
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Cache-Control', 'no-store')
          res.end(JSON.stringify(json))
        })
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // '' prefix = load every variable from .env files + process.env (server side only)
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  return { plugins: [react(), localApiPlugin(env)] }
})
