import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Security headers for development server
// Production headers should be configured at the hosting provider level
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
}

const createContentSecurityPolicy = (supabaseUrl) => {
  const origin = new URL(supabaseUrl).origin
  const websocketOrigin = origin.replace(/^https:/, 'wss:')

  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    `img-src 'self' data: blob: ${origin}`,
    `connect-src 'self' ${origin} ${websocketOrigin}`,
    "frame-ancestors 'none'",
  ].join('; ')
}

const createEnvironmentSecurityPlugin = (contentSecurityPolicy) => ({
  name: 'barber-environment-security',
  transformIndexHtml(html) {
    return html.replace('__BARBER_CSP__', contentSecurityPolicy)
  },
  generateBundle() {
    const headers = [
      ['X-Content-Type-Options', 'nosniff'],
      ['X-Frame-Options', 'DENY'],
      ['Referrer-Policy', 'strict-origin-when-cross-origin'],
      ['Permissions-Policy', 'camera=(), microphone=(), geolocation=()'],
      ['Strict-Transport-Security', 'max-age=31536000; includeSubDomains'],
      ['Content-Security-Policy', contentSecurityPolicy],
    ]

    this.emitFile({
      type: 'asset',
      fileName: 'serve.json',
      source: JSON.stringify({
        headers: [
          {
            source: '**/*',
            headers: headers.map(([key, value]) => ({ key, value })),
          },
          {
            source: 'assets/**',
            headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
          },
        ],
      }, null, 2),
    })

    this.emitFile({
      type: 'asset',
      fileName: '_headers',
      source: `/*\n${headers.map(([key, value]) => `  ${key}: ${value}`).join('\n')}\n`,
    })
  },
})

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const contentSecurityPolicy = createContentSecurityPolicy(env.VITE_SUPABASE_URL)

  return {
    plugins: [react(), createEnvironmentSecurityPlugin(contentSecurityPolicy)],
    server: {
      headers: securityHeaders,
    },
    preview: {
      headers: securityHeaders,
    },
  }
})
