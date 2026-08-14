export type ComponentSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'
export type ComponentVariant = 'solid' | 'soft' | 'outline' | 'ghost' | 'plain'
export type ComponentTone = 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'danger'
export type Orientation = 'horizontal' | 'vertical'
export type Align = 'start' | 'center' | 'end' | 'stretch' | 'baseline'
export type Justify = 'start' | 'center' | 'end' | 'between' | 'around'
export type ComponentRadius = 'none' | 'sm' | 'md' | 'lg' | 'full'

export interface ControllableStateProps<Value> {
  readonly value?: Value
  readonly defaultValue?: Value
  readonly onValueChange?: (value: Value) => void
}

export interface OpenStateProps {
  readonly open?: boolean
  readonly defaultOpen?: boolean
  readonly onOpenChange?: (open: boolean) => void
}
