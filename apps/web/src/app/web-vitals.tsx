'use client'

import { useReportWebVitals } from 'next/web-vitals'
import { recordWebVital } from '../telemetry/browser'

export function WebVitals() {
  useReportWebVitals((metric) => {
    recordWebVital('/', metric)
  })
  return null
}
