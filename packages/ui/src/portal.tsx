'use client'

import { type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface PortalProps {
  readonly children: ReactNode
  readonly container?: Element | DocumentFragment | null
}

export function Portal({ children, container }: PortalProps) {
  const target = container ?? (typeof document === 'undefined' ? null : document.body)
  return target ? createPortal(children, target) : null
}
