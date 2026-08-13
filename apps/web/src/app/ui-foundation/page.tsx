import type { Metadata } from 'next'
import { UiFoundationFixture } from './ui-foundation-fixture'

export const metadata: Metadata = {
  title: 'UI Foundation Fixture',
  robots: { index: false, follow: false },
}

export default function UiFoundationPage() {
  return <UiFoundationFixture />
}
