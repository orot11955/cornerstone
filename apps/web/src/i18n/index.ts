export const supportedLocales = ['ko', 'en'] as const
export type Locale = (typeof supportedLocales)[number]
export type TextDirection = 'ltr' | 'rtl'

const messages = {
  ko: {
    'common.retry': '다시 시도',
    'error.notFound.title': '페이지를 찾을 수 없습니다',
    'error.notFound.description': '주소를 확인하거나 시작 화면으로 돌아가세요.',
    'error.unexpected.title': '요청을 처리하지 못했습니다',
    'error.unexpected.description': '잠시 후 다시 시도해 주세요.',
    'error.home': '시작 화면으로 이동',
  },
  en: {
    'common.retry': 'Try again',
    'error.notFound.title': 'Page not found',
    'error.notFound.description': 'Check the address or return to the start page.',
    'error.unexpected.title': 'We could not complete the request',
    'error.unexpected.description': 'Please try again in a moment.',
    'error.home': 'Go to the start page',
  },
} as const

export type TranslationKey = keyof (typeof messages)['ko']

export function resolveLocale(value: string | null | undefined): Locale {
  if (!value) return 'ko'
  const language = value.trim().toLowerCase().split('-')[0]
  return language === 'en' ? 'en' : 'ko'
}

export function resolveDirection(locale: string): TextDirection {
  const language = locale.trim().toLowerCase().split('-')[0] ?? ''
  return ['ar', 'fa', 'he', 'ur'].includes(language) ? 'rtl' : 'ltr'
}

export function translate(locale: Locale, key: TranslationKey): string {
  return messages[locale][key] ?? messages.ko[key] ?? key
}

export interface FormatContext {
  readonly locale: Locale
  readonly timeZone: string
  readonly currency: string
}

export function formatDateTime(value: Date | string | number, context: FormatContext): string {
  return new Intl.DateTimeFormat(context.locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: context.timeZone,
  }).format(new Date(value))
}

export function formatCurrency(value: number, context: FormatContext): string {
  return new Intl.NumberFormat(context.locale, {
    style: 'currency',
    currency: context.currency,
  }).format(value)
}
