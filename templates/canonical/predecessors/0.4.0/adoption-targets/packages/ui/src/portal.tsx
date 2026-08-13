'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface PortalProps {
  readonly children: ReactNode
  readonly container?: Element | DocumentFragment | null
}

export function Portal({ children, container }: PortalProps) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const target = mounted ? (container ?? document.body) : null
  return target ? createPortal(children, target) : null
}
