import { type HTMLAttributes, type ReactNode } from 'react'
import type { ComponentTone } from './options.js'

function classes(...values: (string | undefined | false)[]): string {
  return values.filter(Boolean).join(' ')
}

export interface StatusProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: Exclude<ComponentTone, 'brand'>
  readonly label?: ReactNode
  readonly showIndicator?: boolean
}

export function Status({
  tone = 'neutral',
  label,
  showIndicator = true,
  children,
  className,
  ...props
}: StatusProps) {
  return (
    <span {...props} data-tone={tone} className={classes('cs-status', className)}>
      {showIndicator ? <span aria-hidden="true" className="cs-status-indicator" /> : null}
      {label ?? children}
    </span>
  )
}

export interface SkeletonProps extends HTMLAttributes<HTMLSpanElement> {
  readonly width?: string | number
  readonly height?: string | number
  readonly shape?: 'text' | 'rectangle' | 'circle'
  readonly label?: string
}

export function Skeleton({
  width,
  height,
  shape = 'text',
  label = 'Loading',
  className,
  style,
  ...props
}: SkeletonProps) {
  return (
    <span
      {...props}
      role="status"
      aria-label={label}
      data-shape={shape}
      className={classes('cs-skeleton', className)}
      style={{ inlineSize: width, blockSize: height, ...style }}
    />
  )
}

interface StateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  readonly title: ReactNode
  readonly description?: ReactNode
  readonly icon?: ReactNode
  readonly actions?: ReactNode
}

export type EmptyStateProps = StateProps

export function EmptyState({
  title,
  description,
  icon,
  actions,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div {...props} className={classes('cs-state', 'cs-empty-state', className)}>
      {icon ? (
        <div aria-hidden="true" className="cs-state-icon">
          {icon}
        </div>
      ) : null}
      <strong className="cs-state-title">{title}</strong>
      {description ? <p className="cs-state-description">{description}</p> : null}
      {actions ? <div className="cs-state-actions">{actions}</div> : null}
    </div>
  )
}

export interface ErrorStateProps extends StateProps {
  readonly announce?: boolean
}

export function ErrorState({ announce = true, className, ...props }: ErrorStateProps) {
  return (
    <EmptyState
      {...props}
      role={announce ? 'alert' : props.role}
      className={classes('cs-error-state', className)}
    />
  )
}
