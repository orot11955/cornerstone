import {
  type HTMLAttributes,
  type ReactNode,
  type TableHTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
  useId,
} from 'react'
import { EmptyState, ErrorState, Skeleton } from './feedback.js'

function classes(...values: (string | undefined | false)[]): string {
  return values.filter(Boolean).join(' ')
}

function Root({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <table {...props} role={props.role ?? 'table'} className={classes('cs-table', className)} />
  )
}

function Caption(props: HTMLAttributes<HTMLTableCaptionElement>) {
  return <caption {...props} className={classes('cs-table-caption', props.className)} />
}

function Header(props: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      {...props}
      role={props.role ?? 'rowgroup'}
      className={classes('cs-table-header', props.className)}
    />
  )
}

function Body(props: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody
      {...props}
      role={props.role ?? 'rowgroup'}
      className={classes('cs-table-body', props.className)}
    />
  )
}

function Footer(props: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tfoot
      {...props}
      role={props.role ?? 'rowgroup'}
      className={classes('cs-table-footer', props.className)}
    />
  )
}

function Row(props: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      {...props}
      role={props.role ?? 'row'}
      className={classes('cs-table-row', props.className)}
    />
  )
}

function Head(props: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      {...props}
      role={props.role ?? 'columnheader'}
      scope={props.scope ?? 'col'}
      className={classes('cs-table-head', props.className)}
    />
  )
}

function Cell(props: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      {...props}
      role={props.role ?? 'cell'}
      className={classes('cs-table-cell', props.className)}
    />
  )
}

export const Table = { Root, Caption, Header, Body, Footer, Row, Head, Cell } as const

export type DataTableResponsiveMode = 'scroll' | 'columns' | 'cards'
export type DataTableSortDirection = 'ascending' | 'descending'

export interface DataTableSort {
  readonly columnId: string
  readonly direction: DataTableSortDirection
}

export interface DataTableColumn<RowData> {
  readonly id: string
  /** Plain-text label used by compact layouts and assistive technology. */
  readonly label: string
  readonly header?: ReactNode
  readonly cell: (row: RowData) => ReactNode
  readonly sortable?: boolean
  readonly priority?: 'primary' | 'secondary' | 'tertiary'
  readonly align?: 'start' | 'center' | 'end'
}

export interface DataTableProps<RowData> extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  readonly caption: ReactNode
  readonly columns: readonly DataTableColumn<RowData>[]
  readonly rows: readonly RowData[]
  readonly getRowId: (row: RowData) => string
  readonly getRowLabel?: (row: RowData) => string
  /** Required so compact-screen behavior is a deliberate product choice. */
  readonly responsiveMode: DataTableResponsiveMode
  readonly sort?: DataTableSort
  readonly onSortChange?: (sort: DataTableSort) => void
  readonly selectedRowIds?: ReadonlySet<string>
  readonly onSelectedRowIdsChange?: (ids: ReadonlySet<string>) => void
  readonly loading?: boolean
  readonly loadingLabel?: string
  readonly emptyState?: ReactNode
  readonly emptyTitle?: ReactNode
  readonly emptyDescription?: ReactNode
  readonly error?: ReactNode
  readonly errorTitle?: ReactNode
  readonly errorDescription?: ReactNode
}

export function DataTable<RowData>({
  caption,
  columns,
  rows,
  getRowId,
  getRowLabel,
  responsiveMode,
  sort,
  onSortChange,
  selectedRowIds,
  onSelectedRowIdsChange,
  loading = false,
  loadingLabel = 'Loading table',
  emptyState,
  emptyTitle = 'No data',
  emptyDescription,
  error,
  errorTitle = 'Unable to load data',
  errorDescription,
  className,
  ...props
}: DataTableProps<RowData>) {
  const captionId = useId()
  if (error)
    return (
      <div
        {...props}
        role="region"
        aria-labelledby={captionId}
        data-responsive-mode={responsiveMode}
        className={classes('cs-data-table', className)}
      >
        <span id={captionId} className="cs-visually-hidden">
          {caption}
        </span>
        {typeof error === 'string' ? (
          <ErrorState title={errorTitle} description={errorDescription ?? error} />
        ) : (
          error
        )}
      </div>
    )
  if (loading)
    return (
      <div
        {...props}
        role="region"
        aria-labelledby={captionId}
        aria-busy="true"
        data-responsive-mode={responsiveMode}
        className={classes('cs-data-table', className)}
      >
        <span id={captionId} className="cs-visually-hidden">
          {caption}
        </span>
        <Skeleton height="8rem" shape="rectangle" label={loadingLabel} />
      </div>
    )
  if (rows.length === 0)
    return (
      <div
        {...props}
        role="region"
        aria-labelledby={captionId}
        data-responsive-mode={responsiveMode}
        className={classes('cs-data-table', className)}
      >
        <span id={captionId} className="cs-visually-hidden">
          {caption}
        </span>
        {emptyState ?? (
          <EmptyState
            title={emptyTitle}
            {...(emptyDescription === undefined ? {} : { description: emptyDescription })}
          />
        )}
      </div>
    )

  const selectable = selectedRowIds !== undefined && onSelectedRowIdsChange !== undefined
  return (
    <div
      {...props}
      data-responsive-mode={responsiveMode}
      className={classes('cs-data-table', className)}
    >
      <Table.Root>
        <Table.Caption>{caption}</Table.Caption>
        <Table.Header>
          <Table.Row>
            {selectable ? (
              <Table.Head className="cs-data-table-selection">
                <span className="cs-visually-hidden">Select</span>
              </Table.Head>
            ) : null}
            {columns.map((column) => (
              <Table.Head
                key={column.id}
                data-priority={column.priority ?? 'secondary'}
                data-align={column.align ?? 'start'}
                aria-sort={sort?.columnId === column.id ? sort.direction : undefined}
              >
                {column.sortable && onSortChange ? (
                  <button
                    type="button"
                    className="cs-data-table-sort"
                    onClick={() =>
                      onSortChange?.({
                        columnId: column.id,
                        direction:
                          sort?.columnId === column.id && sort.direction === 'ascending'
                            ? 'descending'
                            : 'ascending',
                      })
                    }
                  >
                    {column.header ?? column.label}
                  </button>
                ) : (
                  (column.header ?? column.label)
                )}
              </Table.Head>
            ))}
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {rows.map((row) => {
            const rowId = getRowId(row)
            const selected = selectedRowIds?.has(rowId) ?? false
            return (
              <Table.Row key={rowId} data-selected={selected || undefined}>
                {selectable ? (
                  <Table.Cell className="cs-data-table-selection">
                    <input
                      type="checkbox"
                      aria-label={`Select row ${getRowLabel?.(row) ?? rowId}`}
                      checked={selected}
                      onChange={(event) => {
                        const next = new Set(selectedRowIds)
                        if (event.currentTarget.checked) next.add(rowId)
                        else next.delete(rowId)
                        onSelectedRowIdsChange(next)
                      }}
                    />
                  </Table.Cell>
                ) : null}
                {columns.map((column) => (
                  <Table.Cell
                    key={column.id}
                    data-priority={column.priority ?? 'secondary'}
                    data-align={column.align ?? 'start'}
                  >
                    <span className="cs-data-table-card-label">{column.label}</span>
                    <span className="cs-data-table-card-value">{column.cell(row)}</span>
                  </Table.Cell>
                ))}
              </Table.Row>
            )
          })}
        </Table.Body>
      </Table.Root>
    </div>
  )
}
