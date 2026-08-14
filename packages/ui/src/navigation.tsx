import {
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import type { ComponentTone, ComponentVariant } from './options.js'

function classes(...values: (string | undefined | false)[]): string {
  return values.filter(Boolean).join(' ')
}

export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  readonly variant?: Extract<ComponentVariant, 'plain' | 'ghost'>
  readonly tone?: Extract<ComponentTone, 'neutral' | 'brand' | 'danger'>
  readonly current?: boolean | 'page' | 'step' | 'location' | 'date' | 'time'
}

export function Link({
  variant = 'plain',
  tone = 'brand',
  current,
  className,
  ...props
}: LinkProps) {
  return (
    <a
      {...props}
      aria-current={current === true ? 'page' : current || undefined}
      data-variant={variant}
      data-tone={tone}
      className={classes('cs-link', className)}
    />
  )
}

export interface BreadcrumbItem {
  readonly label: ReactNode
  readonly href?: string
}

export interface BreadcrumbProps extends HTMLAttributes<HTMLElement> {
  readonly label?: string
  readonly items: readonly BreadcrumbItem[]
  readonly separator?: ReactNode
}

export function Breadcrumb({
  label = 'Breadcrumb',
  items,
  separator = '/',
  className,
  ...props
}: BreadcrumbProps) {
  return (
    <nav {...props} aria-label={label} className={classes('cs-breadcrumb', className)}>
      <ol>
        {items.map((item, index) => {
          const current = index === items.length - 1
          return (
            <li key={`${index}:${String(item.href ?? '')}`}>
              {item.href && !current ? (
                <Link href={item.href} tone="neutral">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={current ? 'page' : undefined}>{item.label}</span>
              )}
              {!current ? (
                <span aria-hidden="true" className="cs-breadcrumb-separator">
                  {separator}
                </span>
              ) : null}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export interface PaginationProps extends Omit<HTMLAttributes<HTMLElement>, 'onChange'> {
  readonly page: number
  readonly pageCount: number
  readonly onPageChange?: (page: number) => void
  readonly getPageHref?: (page: number) => string
  readonly label?: string
  readonly previousLabel?: ReactNode
  readonly nextLabel?: ReactNode
  readonly siblingCount?: number
}

export function Pagination({
  page,
  pageCount,
  onPageChange,
  getPageHref,
  label = 'Pagination',
  previousLabel = 'Previous',
  nextLabel = 'Next',
  siblingCount = 1,
  className,
  ...props
}: PaginationProps) {
  const safeCount = Math.max(1, Math.floor(pageCount))
  const current = Math.min(safeCount, Math.max(1, Math.floor(page)))
  const pages = pageWindow(current, safeCount, siblingCount)
  return (
    <nav {...props} aria-label={label} className={classes('cs-pagination', className)}>
      <ol>
        <li>{pageControl(current - 1, current === 1, previousLabel, 'Previous page')}</li>
        {pages.map((item, index) =>
          item === 'ellipsis' ? (
            <li key={`ellipsis-${index}`} aria-hidden="true" className="cs-pagination-ellipsis">
              …
            </li>
          ) : (
            <li key={item}>
              {pageControl(item, false, String(item), `Page ${item}`, item === current)}
            </li>
          ),
        )}
        <li>{pageControl(current + 1, current === safeCount, nextLabel, 'Next page')}</li>
      </ol>
    </nav>
  )

  function pageControl(
    target: number,
    disabled: boolean,
    children: ReactNode,
    ariaLabel: string,
    isCurrent = false,
  ) {
    const inactive = disabled || (!getPageHref && !onPageChange)
    const common = {
      'aria-label': ariaLabel,
      'aria-current': isCurrent ? ('page' as const) : undefined,
      className: 'cs-pagination-control',
    }
    if (getPageHref && !inactive)
      return (
        <a {...common} href={getPageHref(target)}>
          {children}
        </a>
      )
    const buttonProps: ButtonHTMLAttributes<HTMLButtonElement> = {
      ...common,
      type: 'button',
      disabled: inactive,
      ...(onPageChange ? { onClick: () => onPageChange(target) } : {}),
    }
    return <button {...buttonProps}>{children}</button>
  }
}

function pageWindow(page: number, count: number, siblingCount: number): (number | 'ellipsis')[] {
  const sibling = Math.max(0, Math.floor(siblingCount))
  const selected = new Set([1, count])
  for (let value = page - sibling; value <= page + sibling; value += 1)
    if (value >= 1 && value <= count) selected.add(value)
  const values = [...selected].sort((a, b) => a - b)
  const result: (number | 'ellipsis')[] = []
  for (const value of values) {
    const previous = result.at(-1)
    if (typeof previous === 'number' && value - previous > 1) result.push('ellipsis')
    result.push(value)
  }
  return result
}
