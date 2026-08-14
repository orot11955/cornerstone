import { createElement, type HTMLAttributes, type ReactElement, type ReactNode } from 'react'
import type { ComponentRadius } from './options.js'
import type { Responsive } from './responsive.js'
import { responsiveProperties } from './responsive.js'
import type { Space } from './components.js'

function classes(...values: (string | undefined | false)[]): string {
  return values.filter(Boolean).join(' ')
}

export interface AppShellProps extends HTMLAttributes<HTMLDivElement> {
  readonly header?: ReactNode
  readonly sidebar?: ReactNode
  readonly children: ReactNode
  readonly skipLabel?: ReactNode
  readonly mainId?: string
}

export function AppShell({
  header,
  sidebar,
  children,
  skipLabel = 'Skip to main content',
  mainId = 'main-content',
  className,
  ...props
}: AppShellProps) {
  return (
    <div {...props} className={classes('cs-app-shell', className)}>
      <a className="cs-skip-link" href={`#${mainId}`}>
        {skipLabel}
      </a>
      {header ? <header className="cs-app-shell-header">{header}</header> : null}
      <div className="cs-app-shell-body">
        {sidebar ? <div className="cs-app-shell-sidebar">{sidebar}</div> : null}
        <main id={mainId} tabIndex={-1} className="cs-app-shell-main">
          {children}
        </main>
      </div>
    </div>
  )
}

export interface PageShellProps extends HTMLAttributes<HTMLDivElement> {
  readonly size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  readonly padding?: Responsive<Space>
}

export function PageShell({
  size = 'xl',
  padding = { base: '4', md: '6', lg: '8' },
  className,
  style,
  ...props
}: PageShellProps) {
  return (
    <div
      {...props}
      data-size={size}
      className={classes('cs-page-shell', className)}
      style={{ ...responsiveProperties('page-shell-padding', padding, spaceValue), ...style }}
    />
  )
}

export interface SidebarProps extends HTMLAttributes<HTMLElement> {
  readonly label: string
  readonly sticky?: boolean
}

export function Sidebar({ label, sticky = true, className, children, ...props }: SidebarProps) {
  return (
    <aside {...props} data-sticky={sticky} className={classes('cs-sidebar', className)}>
      <nav aria-label={label}>{children}</nav>
    </aside>
  )
}

export interface PageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  readonly title: ReactNode
  readonly description?: ReactNode
  readonly breadcrumbs?: ReactNode
  readonly actions?: ReactNode
  readonly headingAs?: 'h1' | 'h2'
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  headingAs = 'h1',
  className,
  ...props
}: PageHeaderProps) {
  return (
    <header {...props} className={classes('cs-page-header', className)}>
      {breadcrumbs ? <div className="cs-page-header-breadcrumbs">{breadcrumbs}</div> : null}
      <div className="cs-page-header-row">
        <div className="cs-page-header-copy">
          {createElement(headingAs, { className: 'cs-heading cs-page-header-title' }, title)}
          {description ? <p className="cs-page-header-description">{description}</p> : null}
        </div>
        {actions ? <div className="cs-page-header-actions">{actions}</div> : null}
      </div>
    </header>
  )
}

export interface ToolbarProps extends HTMLAttributes<HTMLDivElement> {
  readonly label: string
  readonly wrap?: boolean
}

export function Toolbar({ label, wrap = true, className, ...props }: ToolbarProps) {
  return (
    <div
      {...props}
      role={props.role ?? 'group'}
      aria-label={label}
      data-wrap={wrap}
      className={classes('cs-toolbar', className)}
    />
  )
}

/** @deprecated Use the `outline` Card variant. */
type DeprecatedOutlinedCardVariant = 'outlined'
export type CardVariant = 'plain' | 'outline' | 'elevated' | DeprecatedOutlinedCardVariant

export interface CardProps extends HTMLAttributes<HTMLElement> {
  readonly as?: 'article' | 'section' | 'div'
  /** `outlined` is a compatibility alias. Prefer `outline`. */
  readonly variant?: CardVariant
  readonly radius?: ComponentRadius
  readonly padding?: Responsive<Space>
  readonly header?: ReactNode
  readonly footer?: ReactNode
}

export function Card({
  as = 'article',
  variant = 'outline',
  radius = 'lg',
  padding = '5',
  header,
  footer,
  children,
  className,
  style,
  ...props
}: CardProps): ReactElement {
  return createElement(
    as,
    {
      ...props,
      'data-variant': variant,
      'data-radius': radius,
      className: classes('cs-card', className),
      style: { ...responsiveProperties('card-padding', padding, spaceValue), ...style },
    },
    header ? <div className="cs-card-header">{header}</div> : null,
    <div className="cs-card-body">{children}</div>,
    footer ? <div className="cs-card-footer">{footer}</div> : null,
  )
}

function spaceValue(value: Space): string {
  return `var(--cs-space-${value})`
}
