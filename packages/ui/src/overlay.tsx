'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent,
  type MutableRefObject,
  type ReactNode,
} from 'react'
import { Dialog, type DialogContentProps } from './dialog.js'
import type { ComponentTone, OpenStateProps, Orientation } from './options.js'
import { Portal } from './portal.js'

function classes(...values: (string | undefined | false)[]): string {
  return values.filter(Boolean).join(' ')
}

export type FloatingPlacement = 'top' | 'right' | 'bottom' | 'left'
export type FloatingAlign = 'start' | 'center' | 'end'

export interface FloatingRect {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
  readonly width: number
  readonly height: number
}

export interface FloatingPositionOptions {
  readonly placement?: FloatingPlacement | undefined
  readonly align?: FloatingAlign | undefined
  readonly offset?: number | undefined
  readonly collisionPadding?: number | undefined
  readonly direction?: 'ltr' | 'rtl' | undefined
}

export interface FloatingPosition {
  readonly placement: FloatingPlacement
  readonly top: number
  readonly left: number
}

export interface FloatingViewport {
  readonly width: number
  readonly height: number
  readonly top?: number
  readonly left?: number
}

export function computeFloatingPosition(
  anchor: FloatingRect,
  floating: Pick<FloatingRect, 'width' | 'height'>,
  viewport: FloatingViewport,
  {
    placement = 'bottom',
    align = 'start',
    offset = 8,
    collisionPadding = 8,
    direction = 'ltr',
  }: FloatingPositionOptions = {},
): FloatingPosition {
  const viewportTop = viewport.top ?? 0
  const viewportLeft = viewport.left ?? 0
  const viewportRight = viewportLeft + viewport.width
  const viewportBottom = viewportTop + viewport.height
  const spaces = {
    top: anchor.top - viewportTop - collisionPadding,
    right: viewportRight - anchor.right - collisionPadding,
    bottom: viewportBottom - anchor.bottom - collisionPadding,
    left: anchor.left - viewportLeft - collisionPadding,
  }
  const required = placement === 'top' || placement === 'bottom' ? floating.height : floating.width
  const opposite = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' } as const
  const oppositePlacement = opposite[placement]
  const resolvedPlacement =
    spaces[placement] < required + offset && spaces[oppositePlacement] > spaces[placement]
      ? oppositePlacement
      : placement

  let top = anchor.bottom + offset
  let left = anchor.left
  if (resolvedPlacement === 'top') top = anchor.top - floating.height - offset
  if (resolvedPlacement === 'left') left = anchor.left - floating.width - offset
  if (resolvedPlacement === 'right') left = anchor.right + offset

  if (resolvedPlacement === 'top' || resolvedPlacement === 'bottom') {
    if (align === 'center') left = anchor.left + (anchor.width - floating.width) / 2
    else if ((align === 'start') === (direction === 'rtl')) left = anchor.right - floating.width
  } else {
    top = anchor.top
    if (align === 'center') top = anchor.top + (anchor.height - floating.height) / 2
    else if (align === 'end') top = anchor.bottom - floating.height
  }

  return {
    placement: resolvedPlacement,
    top: clamp(
      top,
      viewportTop + collisionPadding,
      viewportBottom - floating.height - collisionPadding,
    ),
    left: clamp(
      left,
      viewportLeft + collisionPadding,
      viewportRight - floating.width - collisionPadding,
    ),
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
}

export interface FloatingContentOptions extends FloatingPositionOptions {
  readonly style?: CSSProperties
}

function useFloatingPosition(
  open: boolean,
  trigger: MutableRefObject<HTMLButtonElement | null>,
  content: HTMLElement | null,
  options: FloatingPositionOptions,
): { readonly placement: FloatingPlacement; readonly style: CSSProperties } {
  const requestedPlacement = options.placement ?? 'bottom'
  const [position, setPosition] = useState<FloatingPosition | null>(null)
  useEffect(() => {
    const anchor = trigger.current
    if (!open || !anchor || !content) return
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const viewport = window.visualViewport
        const next = computeFloatingPosition(
          anchor.getBoundingClientRect(),
          content.getBoundingClientRect(),
          {
            width: viewport?.width ?? window.innerWidth,
            height: viewport?.height ?? window.innerHeight,
            top: viewport?.offsetTop ?? 0,
            left: viewport?.offsetLeft ?? 0,
          },
          { ...options, direction: getComputedStyle(anchor).direction === 'rtl' ? 'rtl' : 'ltr' },
        )
        setPosition((current) =>
          current?.placement === next.placement &&
          current.top === next.top &&
          current.left === next.left
            ? current
            : next,
        )
      })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(anchor)
    observer?.observe(content)
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      window.visualViewport?.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('scroll', update)
    }
  }, [
    content,
    open,
    options.align,
    options.collisionPadding,
    options.offset,
    options.placement,
    trigger,
  ])
  return {
    placement: position?.placement ?? requestedPlacement,
    style: position
      ? { position: 'fixed', top: position.top, left: position.left }
      : { position: 'fixed', visibility: 'hidden' },
  }
}

function useControllableState<Value>(
  controlled: Value | undefined,
  defaultValue: Value,
  onChange?: (value: Value) => void,
): readonly [Value, (value: Value) => void] {
  const [internal, setInternal] = useState(defaultValue)
  const value = controlled ?? internal
  const lastRequested = useRef(value)
  lastRequested.current = value
  const setValue = useCallback(
    (next: Value) => {
      if (Object.is(lastRequested.current, next)) return
      lastRequested.current = next
      if (controlled === undefined) setInternal(next)
      onChange?.(next)
    },
    [controlled, onChange],
  )
  return [value, setValue] as const
}

interface TabsContextValue {
  readonly value?: string
  readonly setValue: (value: string) => void
  readonly orientation: Orientation
  readonly id: string
}

const TabsContext = createContext<TabsContextValue | null>(null)

function useTabs() {
  const context = useContext(TabsContext)
  if (!context) throw new Error('Tabs components must be rendered inside Tabs.Root.')
  return context
}

export interface TabsRootProps extends HTMLAttributes<HTMLDivElement> {
  readonly value?: string
  readonly defaultValue?: string
  readonly onValueChange?: (value: string) => void
  readonly orientation?: Orientation
}

function TabsRoot({
  value: controlled,
  defaultValue,
  onValueChange,
  orientation = 'horizontal',
  className,
  children,
  ...props
}: TabsRootProps) {
  const [value, setValue] = useControllableState(controlled, defaultValue ?? '', onValueChange)
  const id = useId()
  return (
    <TabsContext value={{ value, setValue, orientation, id }}>
      <div {...props} data-orientation={orientation} className={classes('cs-tabs', className)}>
        {children}
      </div>
    </TabsContext>
  )
}

function TabsList({ onKeyDown, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  const { orientation } = useTabs()
  return (
    <div
      {...props}
      role="tablist"
      aria-orientation={orientation}
      className={classes('cs-tabs-list', className)}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (!event.defaultPrevented) moveCompositeFocus(event, orientation)
      }}
    />
  )
}

function TabsTrigger({
  value,
  className,
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { readonly value: string }) {
  const tabs = useTabs()
  const selected = tabs.value === value
  return (
    <button
      {...props}
      type={props.type ?? 'button'}
      role="tab"
      id={`${tabs.id}-tab-${tabPart(value)}`}
      aria-controls={`${tabs.id}-panel-${tabPart(value)}`}
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      className={classes('cs-tabs-trigger', className)}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) tabs.setValue(value)
      }}
    />
  )
}

function TabsContent({
  value,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { readonly value: string }) {
  const tabs = useTabs()
  const selected = tabs.value === value
  return (
    <div
      {...props}
      role="tabpanel"
      id={`${tabs.id}-panel-${tabPart(value)}`}
      aria-labelledby={`${tabs.id}-tab-${tabPart(value)}`}
      hidden={!selected}
      tabIndex={0}
      className={classes('cs-tabs-content', className)}
    />
  )
}

export const Tabs = {
  Root: TabsRoot,
  List: TabsList,
  Trigger: TabsTrigger,
  Content: TabsContent,
} as const

interface PopupContextValue {
  readonly open: boolean
  readonly setOpen: (open: boolean) => void
  readonly trigger: MutableRefObject<HTMLButtonElement | null>
  readonly id: string
}

function createPopupContext(name: string) {
  const Context = createContext<PopupContextValue | null>(null)
  const usePopup = () => {
    const value = useContext(Context)
    if (!value) throw new Error(`${name} components must be rendered inside ${name}.Root.`)
    return value
  }
  return { Context, usePopup }
}

const MenuPopup = createPopupContext('Menu')

export interface MenuRootProps extends OpenStateProps {
  readonly children: ReactNode
}

function MenuRoot({
  children,
  open: controlled,
  defaultOpen = false,
  onOpenChange,
}: MenuRootProps) {
  const [open, setOpen] = useControllableState(controlled, defaultOpen, onOpenChange)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const id = useId()
  return <MenuPopup.Context value={{ open, setOpen, trigger, id }}>{children}</MenuPopup.Context>
}

function MenuTrigger({ onClick, onKeyDown, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const menu = MenuPopup.usePopup()
  return (
    <button
      {...props}
      ref={menu.trigger}
      type={props.type ?? 'button'}
      aria-haspopup="menu"
      aria-expanded={menu.open}
      aria-controls={menu.id}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) menu.setOpen(!menu.open)
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (event.defaultPrevented) return
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          menu.setOpen(true)
        } else if (event.key === 'Escape') {
          menu.setOpen(false)
        }
      }}
    />
  )
}

export interface MenuContentProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'style'>, FloatingContentOptions {}

function MenuContent({
  placement = 'bottom',
  align = 'start',
  offset,
  collisionPadding,
  className,
  onKeyDown,
  style,
  ...props
}: MenuContentProps) {
  const menu = MenuPopup.usePopup()
  const [content, setContent] = useState<HTMLDivElement | null>(null)
  const floating = useFloatingPosition(menu.open, menu.trigger, content, {
    placement,
    align,
    offset,
    collisionPadding,
  })
  useDismiss(menu.open, menu.setOpen, menu.trigger, content)
  useEffect(() => {
    if (!menu.open) return
    const frame = requestAnimationFrame(() => firstEnabledItem(content)?.focus())
    return () => cancelAnimationFrame(frame)
  }, [content, menu.open])
  if (!menu.open) return null
  return (
    <Portal>
      <div
        {...props}
        ref={setContent}
        id={menu.id}
        role="menu"
        tabIndex={-1}
        data-placement={floating.placement}
        className={classes('cs-popup', 'cs-menu', className)}
        style={{ ...floating.style, ...style }}
        onKeyDown={(event) => {
          onKeyDown?.(event)
          if (event.defaultPrevented) return
          moveMenuFocus(event)
          if (event.key === 'Escape') {
            menu.setOpen(false)
            menu.trigger.current?.focus()
          }
        }}
      />
    </Portal>
  )
}

function MenuItem({ className, onClick, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const menu = MenuPopup.usePopup()
  return (
    <button
      {...props}
      type={props.type ?? 'button'}
      role="menuitem"
      tabIndex={-1}
      className={classes('cs-menu-item', className)}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) {
          menu.setOpen(false)
          menu.trigger.current?.focus()
        }
      }}
    />
  )
}

function MenuLink({ className, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const menu = MenuPopup.usePopup()
  return (
    <a
      {...props}
      role="menuitem"
      tabIndex={-1}
      className={classes('cs-menu-item', className)}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) {
          menu.setOpen(false)
          menu.trigger.current?.focus()
        }
      }}
    />
  )
}

export const Menu = {
  Root: MenuRoot,
  Trigger: MenuTrigger,
  Content: MenuContent,
  Item: MenuItem,
  Link: MenuLink,
} as const

export interface DrawerContentProps extends Omit<DialogContentProps, 'closeOnBackdrop'> {
  readonly side?: 'start' | 'end' | 'top' | 'bottom'
  readonly closeOnBackdrop?: boolean
}

function DrawerContent({ side = 'end', closeOnBackdrop, className, ...props }: DrawerContentProps) {
  return (
    <Dialog.Content
      {...props}
      {...(closeOnBackdrop === undefined ? {} : { closeOnBackdrop })}
      data-side={side}
      className={classes('cs-drawer', className)}
    />
  )
}

export const Drawer = {
  Root: Dialog.Root,
  Trigger: Dialog.Trigger,
  Content: DrawerContent,
  Title: Dialog.Title,
  Description: Dialog.Description,
  Close: Dialog.Close,
} as const

const PopoverPopup = createPopupContext('Popover')

export interface PopoverRootProps extends OpenStateProps {
  readonly children: ReactNode
}

function PopoverRoot({
  children,
  open: controlled,
  defaultOpen = false,
  onOpenChange,
}: PopoverRootProps) {
  const [open, setOpen] = useControllableState(controlled, defaultOpen, onOpenChange)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const id = useId()
  return (
    <PopoverPopup.Context value={{ open, setOpen, trigger, id }}>{children}</PopoverPopup.Context>
  )
}

function PopoverTrigger({ onClick, onKeyDown, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const popover = PopoverPopup.usePopup()
  return (
    <button
      {...props}
      ref={popover.trigger}
      type={props.type ?? 'button'}
      aria-expanded={popover.open}
      aria-controls={popover.id}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) popover.setOpen(!popover.open)
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (event.defaultPrevented) return
        if (event.key === 'Escape') popover.setOpen(false)
      }}
    />
  )
}

export interface PopoverContentProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'style'>, FloatingContentOptions {}

function PopoverContent({
  placement = 'bottom',
  align = 'start',
  offset,
  collisionPadding,
  className,
  onKeyDown,
  style,
  ...props
}: PopoverContentProps) {
  const popover = PopoverPopup.usePopup()
  const [content, setContent] = useState<HTMLDivElement | null>(null)
  const floating = useFloatingPosition(popover.open, popover.trigger, content, {
    placement,
    align,
    offset,
    collisionPadding,
  })
  useDismiss(popover.open, popover.setOpen, popover.trigger, content)
  if (!popover.open) return null
  return (
    <Portal>
      <div
        {...props}
        ref={setContent}
        id={popover.id}
        tabIndex={-1}
        data-placement={floating.placement}
        className={classes('cs-popup', 'cs-popover', className)}
        style={{ ...floating.style, ...style }}
        onKeyDown={(event) => {
          onKeyDown?.(event)
          if (event.defaultPrevented) return
          if (event.key === 'Escape') {
            popover.setOpen(false)
            popover.trigger.current?.focus()
          }
        }}
      />
    </Portal>
  )
}

function PopoverClose({ onClick, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const popover = PopoverPopup.usePopup()
  return (
    <button
      {...props}
      type={props.type ?? 'button'}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) {
          popover.setOpen(false)
          popover.trigger.current?.focus()
        }
      }}
    />
  )
}

export const Popover = {
  Root: PopoverRoot,
  Trigger: PopoverTrigger,
  Content: PopoverContent,
  Close: PopoverClose,
} as const

interface TooltipContextValue extends PopupContextValue {
  readonly descriptionId: string
  readonly setReason: (reason: TooltipOpenReason, active: boolean) => void
  readonly toggleReason: (reason: TooltipOpenReason) => void
  readonly clearReasons: () => void
}
type TooltipOpenReason = 'hover' | 'focus' | 'touch'
const TooltipContext = createContext<TooltipContextValue | null>(null)

function useTooltip() {
  const context = useContext(TooltipContext)
  if (!context) throw new Error('Tooltip components must be rendered inside Tooltip.Root.')
  return context
}

export interface TooltipRootProps extends OpenStateProps {
  readonly children: ReactNode
}

function TooltipRoot({
  children,
  open: controlled,
  defaultOpen = false,
  onOpenChange,
}: TooltipRootProps) {
  const [open, setOpen] = useControllableState(controlled, defaultOpen, onOpenChange)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const reasons = useRef(new Set<TooltipOpenReason>())
  const id = useId()
  const setReason = useCallback(
    (reason: TooltipOpenReason, active: boolean) => {
      const currentlyActive = reasons.current.has(reason)
      if (currentlyActive === active) return
      if (active) reasons.current.add(reason)
      else reasons.current.delete(reason)
      setOpen(reasons.current.size > 0)
    },
    [setOpen],
  )
  const toggleReason = useCallback(
    (reason: TooltipOpenReason) => setReason(reason, !reasons.current.has(reason)),
    [setReason],
  )
  const clearReasons = useCallback(() => {
    if (reasons.current.size === 0) return
    reasons.current.clear()
    setOpen(false)
  }, [setOpen])
  return (
    <TooltipContext
      value={{
        open,
        setOpen,
        trigger,
        id,
        descriptionId: `${id}-content`,
        setReason,
        toggleReason,
        clearReasons,
      }}
    >
      {children}
    </TooltipContext>
  )
}

function TooltipTrigger({
  onFocus,
  onBlur,
  onMouseEnter,
  onMouseLeave,
  onKeyDown,
  onPointerDown,
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const tooltip = useTooltip()
  const lastPointerType = useRef<string | null>(null)
  return (
    <button
      {...props}
      ref={tooltip.trigger}
      type={props.type ?? 'button'}
      aria-describedby={tooltip.open ? tooltip.descriptionId : props['aria-describedby']}
      onFocus={(event) => {
        onFocus?.(event)
        if (!event.defaultPrevented && lastPointerType.current !== 'touch')
          tooltip.setReason('focus', true)
      }}
      onBlur={(event) => {
        onBlur?.(event)
        if (!event.defaultPrevented) {
          tooltip.setReason('focus', false)
          tooltip.setReason('touch', false)
          lastPointerType.current = null
        }
      }}
      onMouseEnter={(event) => {
        onMouseEnter?.(event)
        if (!event.defaultPrevented && lastPointerType.current !== 'touch')
          tooltip.setReason('hover', true)
      }}
      onMouseLeave={(event) => {
        onMouseLeave?.(event)
        if (!event.defaultPrevented) tooltip.setReason('hover', false)
      }}
      onPointerDown={(event) => {
        onPointerDown?.(event)
        if (!event.defaultPrevented) lastPointerType.current = event.pointerType
      }}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented && lastPointerType.current === 'touch')
          tooltip.toggleReason('touch')
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (!event.defaultPrevented && event.key === 'Escape') tooltip.clearReasons()
      }}
    />
  )
}

export interface TooltipContentProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'style'>, FloatingContentOptions {}

function TooltipContent({
  placement = 'top',
  align = 'center',
  offset,
  collisionPadding,
  className,
  style,
  ...props
}: TooltipContentProps) {
  const tooltip = useTooltip()
  const [content, setContent] = useState<HTMLDivElement | null>(null)
  const floating = useFloatingPosition(tooltip.open, tooltip.trigger, content, {
    placement,
    align,
    offset,
    collisionPadding,
  })
  if (!tooltip.open) return null
  return (
    <Portal>
      <div
        {...props}
        ref={setContent}
        id={tooltip.descriptionId}
        role="tooltip"
        data-placement={floating.placement}
        className={classes('cs-tooltip', className)}
        style={{ ...floating.style, ...style }}
      />
    </Portal>
  )
}

export const Tooltip = {
  Root: TooltipRoot,
  Trigger: TooltipTrigger,
  Content: TooltipContent,
} as const

function ToastViewport(props: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      role={props.role ?? 'region'}
      aria-label={props['aria-label'] ?? 'Notifications'}
      className={classes('cs-toast-viewport', props.className)}
    />
  )
}

export interface ToastRootProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  readonly tone?: Exclude<ComponentTone, 'brand'>
  readonly title?: ReactNode
  readonly description?: ReactNode
  readonly action?: ReactNode
}

function ToastRoot({
  tone = 'neutral',
  title,
  description,
  action,
  className,
  children,
  ...props
}: ToastRootProps) {
  return (
    <div
      {...props}
      role={tone === 'danger' ? 'alert' : 'status'}
      data-tone={tone}
      className={classes('cs-toast', className)}
    >
      <div className="cs-toast-copy">
        {title ? <strong>{title}</strong> : null}
        {description ? <div>{description}</div> : null}
        {children}
      </div>
      {action ? <div className="cs-toast-action">{action}</div> : null}
    </div>
  )
}

export const Toast = { Viewport: ToastViewport, Root: ToastRoot } as const

function useDismiss(
  open: boolean,
  setOpen: (open: boolean) => void,
  trigger: MutableRefObject<HTMLButtonElement | null>,
  content: HTMLElement | null,
) {
  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent | FocusEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (!trigger.current?.contains(target) && !content?.contains(target)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('focusin', dismiss)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('focusin', dismiss)
    }
  }, [content, open, setOpen, trigger])
}

function firstEnabledItem(container: HTMLElement | null): HTMLElement | null {
  return container?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])') ?? null
}

function moveCompositeFocus(event: KeyboardEvent<HTMLElement>, orientation: Orientation) {
  const rtl =
    orientation === 'horizontal' && getComputedStyle(event.currentTarget).direction === 'rtl'
  const previous = orientation === 'horizontal' ? (rtl ? 'ArrowRight' : 'ArrowLeft') : 'ArrowUp'
  const next = orientation === 'horizontal' ? (rtl ? 'ArrowLeft' : 'ArrowRight') : 'ArrowDown'
  if (![previous, next, 'Home', 'End'].includes(event.key)) return
  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]:not([disabled])'),
  )
  if (items.length === 0) return
  const current = items.indexOf(document.activeElement as HTMLElement)
  const index =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : event.key === previous
          ? (current - 1 + items.length) % items.length
          : (current + 1) % items.length
  event.preventDefault()
  items[index]?.focus()
  items[index]?.click()
}

function moveMenuFocus(event: KeyboardEvent<HTMLElement>) {
  if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'),
  )
  if (items.length === 0) return
  const current = items.indexOf(document.activeElement as HTMLElement)
  const index =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : event.key === 'ArrowUp'
          ? (current - 1 + items.length) % items.length
          : (current + 1) % items.length
  event.preventDefault()
  items[index]?.focus()
}

function tabPart(value: string): string {
  return encodeURIComponent(value)
}
