'use client'

import { useReportWebVitals } from 'next/web-vitals'
import { recordWebVital, resolveTelemetryRoutePattern } from '../telemetry/browser'

export function WebVitals() {
  useReportWebVitals((metric) => {
    recordWebVital(resolveTelemetryRoutePattern(window.location.pathname), metric)
  })
  return null
}
