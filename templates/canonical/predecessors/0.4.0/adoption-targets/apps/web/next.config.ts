import type { NextConfig } from 'next'
import { PHASE_PRODUCTION_SERVER } from 'next/constants'
import { resolveWebConfig } from './src/config/web'

export default function nextConfig(phase: string): NextConfig {
  const webConfig = resolveWebConfig(process.env)
  if (phase === PHASE_PRODUCTION_SERVER) {
    resolveWebConfig(process.env, { requireSecureOrigin: true })
  }

  return {
    distDir: process.env.NEXT_DIST_DIR || '.next',
    env: {
      NEXT_PUBLIC_APP_LOCALE: webConfig.locale,
    },
    poweredByHeader: false,
  }
}
