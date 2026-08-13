import {
  createElement,
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ElementType,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import {
  containerResponsiveProperties,
  responsiveProperties,
  type ContainerResponsive,
  type Responsive,
} from './responsive.js'

export type ComponentSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'
export type ComponentTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info'
export type ComponentRadius = 'none' | 'sm' | 'md' | 'lg' | 'full'
export type Space = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '8' | '10' | '12'

function classes(...values: (string | undefined | false)[]): string {
  return values.filter(Boolean).join(' ')
}

export interface BoxProps extends HTMLAttributes<HTMLElement> {
  readonly as?: ElementType
  readonly padding?: Responsive<Space>
  readonly display?: Responsive<'block' | 'flex' | 'grid' | 'none'>
}

export function Box({ as = 'div', padding, display, className, style, ...props }: BoxProps) {
  return createElement(as, {
    ...props,
    className: classes('cs-box', className),
    style: {
      ...responsiveProperties('box-padding', padding, spaceValue),
      ...responsiveProperties('box-display', display),
      ...style,
    },
  })
}

export interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  readonly size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  readonly gutter?: Responsive<Space>
  /** Enables a named ancestor container for container-responsive descendants. */
  readonly containerQuery?: boolean
}

export function Container({
  size = 'lg',
  gutter = '4',
  containerQuery = false,
  className,
  style,
  ...props
}: ContainerProps) {
  return (
    <div
      {...props}
      data-size={size}
      data-container-query={containerQuery || undefined}
      className={classes('cs-container', className)}
      style={{
        ...responsiveProperties('container-gutter', gutter, spaceValue),
        ...style,
      }}
    />
  )
}

export interface StackProps extends HTMLAttributes<HTMLDivElement> {
  readonly gap?: Responsive<Space>
  readonly direction?: Responsive<'vertical' | 'horizontal'>
  readonly align?: Responsive<'stretch' | 'start' | 'center' | 'end'>
  readonly justify?: Responsive<'start' | 'center' | 'end' | 'between'>
}

export function Stack({
  gap = '4',
  direction = 'vertical',
  align = 'stretch',
  justify = 'start',
  className,
  style,
  ...props
}: StackProps) {
  return (
    <div
      {...props}
      data-align={typeof align === 'string' ? align : undefined}
      className={classes('cs-stack', className)}
      style={{
        ...responsiveProperties('stack-gap', gap, spaceValue),
        ...responsiveProperties('stack-direction', direction, directionValue),
        ...responsiveProperties('stack-align', align, alignValue),
        ...responsiveProperties('stack-justify', justify, justifyValue),
        ...style,
      }}
    />
  )
}

export interface InlineProps extends HTMLAttributes<HTMLDivElement> {
  readonly gap?: Responsive<Space>
  readonly align?: 'start' | 'center' | 'end' | 'baseline' | 'stretch'
  readonly justify?: 'start' | 'center' | 'end' | 'between'
  readonly wrap?: boolean
}

export function Inline({
  gap = '3',
  align = 'center',
  justify = 'start',
  wrap = true,
  className,
  style,
  ...props
}: InlineProps) {
  return (
    <div
      {...props}
      data-align={align}
      data-justify={justify}
      data-wrap={wrap}
      className={classes('cs-inline', className)}
      style={{ ...responsiveProperties('inline-gap', gap, spaceValue), ...style }}
    />
  )
}

type GridColumnCount = 1 | 2 | 3 | 4 | 6 | 12
export type GridMeasure = 'xs' | 'sm' | 'md' | 'lg'
type GridTrackProps =
  | {
      readonly columns?: Responsive<GridColumnCount>
      readonly minItemWidth?: never
      readonly containerColumns?: never
    }
  | {
      readonly columns?: never
      readonly minItemWidth: GridMeasure
      readonly containerColumns?: never
    }
  | {
      readonly columns?: never
      readonly minItemWidth?: never
      readonly containerColumns: ContainerResponsive<GridColumnCount>
    }

export type GridProps = HTMLAttributes<HTMLDivElement> &
  GridTrackProps & {
    readonly gap?: Responsive<Space>
  }

export function Grid({
  columns,
  minItemWidth,
  containerColumns,
  gap = '4',
  className,
  style,
  ...props
}: GridProps) {
  const gridStyle: CSSProperties = {
    ...(columns === undefined && !minItemWidth && !containerColumns
      ? responsiveProperties('grid-columns', 1)
      : responsiveProperties('grid-columns', columns)),
    ...responsiveProperties('grid-gap', gap, spaceValue),
    ...(minItemWidth
      ? ({ '--cs-grid-min': `var(--cs-grid-measure-${minItemWidth})` } as CSSProperties)
      : {}),
    ...containerResponsiveProperties('grid-container-columns', containerColumns),
    ...style,
  }
  return (
    <div
      {...props}
      data-grid-mode={minItemWidth ? 'min' : containerColumns ? 'container' : 'columns'}
      className={classes('cs-grid', className)}
      style={gridStyle}
    />
  )
}

export interface TextProps extends HTMLAttributes<HTMLElement> {
  readonly as?: 'p' | 'span' | 'div' | 'strong' | 'small'
  readonly size?: ComponentSize
  readonly tone?: ComponentTone | 'muted'
  readonly weight?: 'regular' | 'medium' | 'semibold' | 'bold'
  readonly truncate?: boolean
}

export function Text({
  as = 'span',
  size = 'md',
  tone = 'neutral',
  weight = 'regular',
  truncate = false,
  className,
  ...props
}: TextProps) {
  return createElement(as, {
    ...props,
    className: classes('cs-text', className),
    'data-size': size,
    'data-tone': tone,
    'data-weight': weight,
    'data-truncate': truncate,
  })
}

export interface HeadingProps extends HTMLAttributes<HTMLHeadingElement> {
  readonly as?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
  readonly size?: ComponentSize
}

export function Heading({ as = 'h2', size = 'lg', className, ...props }: HeadingProps) {
  return createElement(as, {
    ...props,
    className: classes('cs-heading', className),
    'data-size': size,
  })
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: 'solid' | 'outline' | 'ghost' | 'soft' | 'link'
  readonly tone?: ComponentTone
  readonly size?: ComponentSize
  readonly radius?: ComponentRadius
  readonly loading?: boolean
  readonly fullWidth?: boolean
}

export function Button({
  variant = 'solid',
  tone = 'brand',
  size = 'md',
  radius = 'md',
  loading = false,
  fullWidth = false,
  disabled,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-variant={variant}
      data-tone={tone}
      data-size={size}
      data-radius={radius}
      data-full-width={fullWidth}
      className={classes('cs-button', className)}
    >
      {loading ? <span className="cs-spinner" aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  )
}

interface ControlOptions {
  readonly size?: ComponentSize
  readonly radius?: ComponentRadius
  readonly invalid?: boolean
  readonly fullWidth?: boolean
}

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>, ControlOptions {}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = 'md', radius = 'md', invalid = false, fullWidth = true, className, ...props },
  ref,
) {
  return (
    <input
      {...props}
      ref={ref}
      aria-invalid={invalid || props['aria-invalid'] || undefined}
      data-size={size}
      data-radius={radius}
      data-full-width={fullWidth}
      className={classes('cs-control', 'cs-input', className)}
    />
  )
})

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement>, ControlOptions {}

export function Textarea({
  size = 'md',
  radius = 'md',
  invalid = false,
  fullWidth = true,
  className,
  ...props
}: TextareaProps) {
  return (
    <textarea
      {...props}
      aria-invalid={invalid || props['aria-invalid'] || undefined}
      data-size={size}
      data-radius={radius}
      data-full-width={fullWidth}
      className={classes('cs-control', 'cs-textarea', className)}
    />
  )
}

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'>, ControlOptions {}

export function Select({
  size = 'md',
  radius = 'md',
  invalid = false,
  fullWidth = true,
  className,
  ...props
}: SelectProps) {
  return (
    <select
      {...props}
      aria-invalid={invalid || props['aria-invalid'] || undefined}
      data-size={size}
      data-radius={radius}
      data-full-width={fullWidth}
      className={classes('cs-control', 'cs-select', className)}
    />
  )
}

export interface SelectionProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'size' | 'type'
> {
  readonly label: ReactNode
  readonly description?: ReactNode
  readonly size?: 'sm' | 'md' | 'lg'
  readonly invalid?: boolean
}

function Selection({
  type,
  label,
  description,
  size = 'md',
  invalid = false,
  className,
  ...props
}: SelectionProps & { readonly type: 'checkbox' | 'radio' }) {
  const generatedId = useId()
  const id = props.id ?? `cs-selection-${generatedId}`
  const descriptionId = description ? `${id}-description` : undefined
  return (
    <label className={classes('cs-selection', className)} data-size={size}>
      <input
        {...props}
        id={id}
        type={type}
        aria-invalid={invalid || props['aria-invalid'] || undefined}
        aria-describedby={props['aria-describedby'] ?? descriptionId}
      />
      <span className="cs-selection-control" aria-hidden="true" />
      <span className="cs-selection-content">
        <span>{label}</span>
        {description ? (
          <span id={descriptionId} className="cs-description">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  )
}

export function Checkbox(props: SelectionProps) {
  return <Selection {...props} type="checkbox" />
}

export function Radio(props: SelectionProps) {
  return <Selection {...props} type="radio" />
}

export interface SwitchProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'size' | 'type' | 'role'
> {
  readonly label: ReactNode
  readonly description?: ReactNode
  readonly size?: 'sm' | 'md' | 'lg'
}

export function Switch({ label, description, size = 'md', className, ...props }: SwitchProps) {
  const generatedId = useId()
  const id = props.id ?? `cs-switch-${generatedId}`
  const descriptionId = description ? `${id}-description` : undefined
  return (
    <label className={classes('cs-switch', className)} data-size={size}>
      <input
        {...props}
        id={id}
        type="checkbox"
        role="switch"
        aria-describedby={props['aria-describedby'] ?? descriptionId}
      />
      <span className="cs-switch-track" aria-hidden="true">
        <span />
      </span>
      <span className="cs-selection-content">
        <span>{label}</span>
        {description ? (
          <span id={descriptionId} className="cs-description">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  )
}

export interface FormFieldControlProps {
  readonly id: string
  readonly 'aria-describedby'?: string
  readonly 'aria-invalid'?: true
  readonly required?: boolean
}

export interface FormFieldProps {
  readonly label: ReactNode
  readonly description?: ReactNode
  readonly error?: ReactNode
  readonly required?: boolean
  readonly optionalLabel?: ReactNode
  readonly id?: string
  readonly children: (props: FormFieldControlProps) => ReactNode
}

export function FormField({
  label,
  description,
  error,
  required = false,
  optionalLabel = 'Optional',
  id,
  children,
}: FormFieldProps) {
  const generatedId = useId()
  const controlId = id ?? `cs-field-${generatedId}`
  const descriptionId = description ? `${controlId}-description` : undefined
  const errorId = error ? `${controlId}-error` : undefined
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div className="cs-form-field" data-invalid={Boolean(error)}>
      <label className="cs-label" htmlFor={controlId}>
        <span>{label}</span>
        {!required && optionalLabel ? <span className="cs-optional">{optionalLabel}</span> : null}
      </label>
      {description ? (
        <div id={descriptionId} className="cs-description">
          {description}
        </div>
      ) : null}
      {children({
        id: controlId,
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        ...(error ? { 'aria-invalid': true as const } : {}),
        ...(required ? { required: true } : {}),
      })}
      {error ? (
        <div id={errorId} className="cs-error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  )
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: ComponentTone
  readonly variant?: 'solid' | 'soft' | 'outline'
  readonly size?: 'sm' | 'md'
}

export function Badge({
  tone = 'neutral',
  variant = 'soft',
  size = 'md',
  className,
  ...props
}: BadgeProps) {
  return (
    <span
      {...props}
      data-tone={tone}
      data-variant={variant}
      data-size={size}
      className={classes('cs-badge', className)}
    />
  )
}

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  readonly tone?: Exclude<ComponentTone, 'brand'>
  readonly title?: ReactNode
}

export function Alert({ tone = 'info', title, children, className, ...props }: AlertProps) {
  return (
    <div
      {...props}
      role={tone === 'danger' ? 'alert' : 'status'}
      data-tone={tone}
      className={classes('cs-alert', className)}
    >
      {title ? <strong className="cs-alert-title">{title}</strong> : null}
      <div>{children}</div>
    </div>
  )
}

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  readonly as?: 'section' | 'article' | 'div'
  readonly variant?: 'plain' | 'outlined' | 'elevated'
  readonly padding?: Responsive<Space>
  readonly radius?: ComponentRadius
}

export interface DialogSurfaceProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  readonly title: ReactNode
  readonly description?: ReactNode
  readonly footer?: ReactNode
  readonly labelledBy?: string
}

export function DialogSurface({
  title,
  description,
  footer,
  labelledBy,
  children,
  className,
  ...props
}: DialogSurfaceProps) {
  const generatedId = useId()
  const titleId = labelledBy ?? `cs-dialog-title-${generatedId}`
  const descriptionId = description ? `cs-dialog-description-${generatedId}` : undefined
  return (
    <div
      {...props}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className={classes('cs-dialog', className)}
    >
      <Heading as="h2" size="lg" id={titleId}>
        {title}
      </Heading>
      {description ? (
        <div id={descriptionId} className="cs-description">
          {description}
        </div>
      ) : null}
      <div className="cs-dialog-body">{children}</div>
      {footer ? <div className="cs-dialog-footer">{footer}</div> : null}
    </div>
  )
}

export function Panel({
  as = 'section',
  variant = 'outlined',
  padding = '5',
  radius = 'lg',
  className,
  style,
  ...props
}: PanelProps): ReactElement {
  return createElement(as, {
    ...props,
    'data-variant': variant,
    'data-radius': radius,
    className: classes('cs-panel', className),
    style: { ...responsiveProperties('panel-padding', padding, spaceValue), ...style },
  })
}

export function Separator(props: HTMLAttributes<HTMLHRElement>) {
  return <hr {...props} className={classes('cs-separator', props.className)} />
}

export interface ProgressProps extends HTMLAttributes<HTMLDivElement> {
  readonly value: number
  readonly max?: number
  readonly label: string
}

export function Progress({ value, max = 100, label, className, ...props }: ProgressProps) {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 100
  const safeValue = Number.isFinite(value) ? Math.max(0, Math.min(value, safeMax)) : 0
  return (
    <div
      {...props}
      className={classes('cs-progress', className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={safeValue}
    >
      <span style={{ inlineSize: `${(safeValue / safeMax) * 100}%` }} />
    </div>
  )
}

export function Spinner({
  label = 'Loading',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { readonly label?: string }) {
  return (
    <span
      {...props}
      role="status"
      aria-label={label}
      className={classes('cs-spinner', className)}
    />
  )
}

export function VisuallyHidden({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span {...props} className={classes('cs-visually-hidden', className)} />
}

export interface AspectRatioProps extends HTMLAttributes<HTMLDivElement> {
  readonly ratio: number | `${number} / ${number}`
}

export function AspectRatio({ ratio, className, style, ...props }: AspectRatioProps) {
  const value = typeof ratio === 'number' ? String(ratio) : ratio
  return (
    <div
      {...props}
      className={classes('cs-aspect-ratio', className)}
      style={{ '--cs-aspect-ratio': value, ...style } as CSSProperties}
    />
  )
}

export interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
  readonly axis?: 'block' | 'inline' | 'both'
  readonly scrollbar?: 'auto' | 'always' | 'hidden'
}

export function ScrollArea({
  axis = 'block',
  scrollbar = 'auto',
  className,
  ...props
}: ScrollAreaProps) {
  return (
    <div
      {...props}
      data-axis={axis}
      data-scrollbar={scrollbar}
      className={classes('cs-scroll-area', className)}
    />
  )
}

function spaceValue(value: Space): string {
  return `var(--cs-space-${value})`
}

function directionValue(value: 'vertical' | 'horizontal'): string {
  return value === 'vertical' ? 'column' : 'row'
}

function alignValue(value: 'stretch' | 'start' | 'center' | 'end'): string {
  return value === 'start' ? 'flex-start' : value === 'end' ? 'flex-end' : value
}

function justifyValue(value: 'start' | 'center' | 'end' | 'between'): string {
  if (value === 'start') return 'flex-start'
  if (value === 'end') return 'flex-end'
  return value === 'between' ? 'space-between' : value
}
