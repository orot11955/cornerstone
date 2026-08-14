'use client'

import { useState } from 'react'

export function ErrorRecoveryTrigger() {
  const [shouldThrow, setShouldThrow] = useState(false)
  if (shouldThrow) throw new Error('UI foundation error recovery fixture')

  return (
    <button type="button" onClick={() => setShouldThrow(true)}>
      오류 발생
    </button>
  )
}
