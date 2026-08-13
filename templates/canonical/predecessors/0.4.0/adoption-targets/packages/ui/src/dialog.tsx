'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type DialogHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent,
  type MutableRefObject,
  type RefObject,
  type ReactNode,
} from 'react'
import { Portal } from './portal.js'

interface DialogContextValue {
  readonly open: boolean
  readonly setOpen: (open: boolean) => void
  readonly trigger: MutableRefObject<HTMLButtonElement | null>
  readonly contentId: string
  readonly setContentId: (id: string) => void
}

const DialogContext = createContext<DialogContextValue | null>(null)

function useDialogContext(): DialogContextValue {
  const context = useContext(DialogContext)
  if (!context) throw new Error('Dialog components must be rendered inside Dialog.Root.')
  return context
}

export interface DialogRootProps {
  readonly children: ReactNode
  readonly open?: boolean
  readonly defaultOpen?: boolean
  readonly onOpenChange?: (open: boolean) => void
}

function Root({
  children,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
}: DialogRootProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const open = controlledOpen ?? uncontrolledOpen
  const trigger = useRef<HTMLButtonElement | null>(null)
  const generatedContentId = useId()
  const [contentId, setContentId] = useState(generatedContentId)
  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(next)
      onOpenChange?.(next)
    },
    [controlledOpen, onOpenChange],
  )
  return (
    <DialogContext value={{ open, setOpen, trigger, contentId, setContentId }}>
      {children}
    </DialogContext>
  )
}

export function Trigger({ onClick, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { open, setOpen, trigger, contentId } = useDialogContext()
  return (
    <button
      {...props}
      ref={trigger}
      type={props.type ?? 'button'}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={contentId}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) setOpen(true)
      }}
    />
  )
}

export interface DialogContentProps extends Omit<
  DialogHTMLAttributes<HTMLDialogElement>,
  'onClose'
> {
  readonly initialFocusRef?: RefObject<HTMLElement | null>
  readonly closeOnBackdrop?: boolean
  readonly children: ReactNode
}

export function Content({
  initialFocusRef,
  closeOnBackdrop = true,
  children,
  onClick,
  onKeyDown,
  ...props
}: DialogContentProps) {
  const { open, setOpen, trigger, contentId, setContentId } = useDialogContext()
  const ref = useRef<HTMLDialogElement>(null)
  const generatedTitleId = useId()
  const generatedDescriptionId = useId()
  const synchronizingClose = useRef(false)
  const titleRegistrations = useRef(createSingleDialogLabelRegistry('Dialog.Title'))
  const descriptionRegistrations = useRef(createSingleDialogLabelRegistry('Dialog.Description'))
  const [titleId, setTitleId] = useState<string | null>(null)
  const [descriptionId, setDescriptionId] = useState<string | null>(null)
  const registerTitle = useCallback(
    (id: string) => registerSingleDialogLabel(id, titleRegistrations, setTitleId),
    [],
  )
  const registerDescription = useCallback(
    (id: string) => registerSingleDialogLabel(id, descriptionRegistrations, setDescriptionId),
    [],
  )
  const actualContentId = props.id ?? contentId
  useLayoutEffect(() => {
    setContentId(actualContentId)
  }, [actualContentId, setContentId])
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      const initial = initialFocusRef?.current ?? firstFocusable(dialog)
      initial?.focus()
    }
    if (!open && dialog.open) {
      synchronizingClose.current = true
      dialog.close()
    }
  }, [initialFocusRef, open])
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const close = () => {
      if (synchronizingClose.current) synchronizingClose.current = false
      else setOpen(false)
      trigger.current?.focus()
    }
    const cancel = (event: Event) => {
      event.preventDefault()
      setOpen(false)
    }
    dialog.addEventListener('close', close)
    dialog.addEventListener('cancel', cancel)
    return () => {
      dialog.removeEventListener('close', close)
      dialog.removeEventListener('cancel', cancel)
    }
  }, [setOpen, trigger])
  return (
    <Portal>
      <dialog
        {...props}
        ref={ref}
        id={actualContentId}
        aria-modal="true"
        aria-labelledby={props['aria-labelledby'] ?? titleId ?? undefined}
        aria-describedby={props['aria-describedby'] ?? descriptionId ?? undefined}
        className={['cs-dialog', props.className].filter(Boolean).join(' ')}
        onClick={(event) => {
          if (closeOnBackdrop && event.target === event.currentTarget) setOpen(false)
          onClick?.(event)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Tab') containFocus(event.currentTarget, event)
          onKeyDown?.(event)
        }}
      >
        <DialogIdsContext
          value={{ generatedTitleId, generatedDescriptionId, registerTitle, registerDescription }}
        >
          {children}
        </DialogIdsContext>
      </dialog>
    </Portal>
  )
}

const DialogIdsContext = createContext<{
  generatedTitleId: string
  generatedDescriptionId: string
  registerTitle: (id: string) => () => void
  registerDescription: (id: string) => () => void
} | null>(null)

export function Title(props: HTMLAttributes<HTMLHeadingElement>) {
  const ids = useContext(DialogIdsContext)
  const actualId = props.id ?? ids?.generatedTitleId
  const registerTitle = ids?.registerTitle
  useLayoutEffect(() => {
    if (!actualId) return
    return registerTitle?.(actualId)
  }, [actualId, registerTitle])
  return (
    <h2
      {...props}
      id={actualId}
      className={['cs-heading', props.className].filter(Boolean).join(' ')}
    />
  )
}

export function Description(props: HTMLAttributes<HTMLParagraphElement>) {
  const ids = useContext(DialogIdsContext)
  const actualId = props.id ?? ids?.generatedDescriptionId
  const registerDescription = ids?.registerDescription
  useLayoutEffect(() => {
    if (!actualId) return
    return registerDescription?.(actualId)
  }, [actualId, registerDescription])
  return (
    <p
      {...props}
      id={actualId}
      className={['cs-description', props.className].filter(Boolean).join(' ')}
    />
  )
}

export function Close({ onClick, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { setOpen } = useDialogContext()
  return (
    <button
      {...props}
      type={props.type ?? 'button'}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) setOpen(false)
      }}
    />
  )
}

function firstFocusable(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )
}

function registerSingleDialogLabel(
  id: string,
  registrations: MutableRefObject<SingleDialogLabelRegistry>,
  update: (id: string | null) => void,
): () => void {
  const unregister = registrations.current.register(id)
  update(id)
  return () => {
    unregister()
    update(null)
  }
}

export interface SingleDialogLabelRegistry {
  register: (id: string) => () => void
}

export function createSingleDialogLabelRegistry(
  component: 'Dialog.Title' | 'Dialog.Description',
): SingleDialogLabelRegistry {
  let registered = false
  return {
    register: () => {
      if (registered) throw new Error(`${component} must be unique per Dialog.`)
      registered = true
      return () => {
        registered = false
      }
    },
  }
}

function containFocus(dialog: HTMLDialogElement, event: KeyboardEvent<HTMLDialogElement>) {
  const items = Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  )
  if (items.length === 0) return
  const first = items[0]!
  const last = items[items.length - 1]!
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

export const Dialog = { Root, Trigger, Content, Title, Description, Close } as const
