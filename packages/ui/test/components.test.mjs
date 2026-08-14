import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { readFile } from 'node:fs/promises'
import {
  AppShell,
  Breadcrumb,
  Button,
  Card,
  DataTable,
  EmptyState,
  Checkbox,
  DialogSurface,
  FormField,
  Grid,
  Input,
  PageHeader,
  PageShell,
  Pagination,
  Progress,
  Switch,
  Table,
  Toolbar,
  appearanceDataAttributes,
  appearancePresentation,
  createAppearanceRegistry,
  defineBrand,
  foundationTokens,
  resolveAppearance,
  tokenDeclarations,
  tokenSourceId,
} from '../dist/index.js'
import {
  applyAppearance,
  Portal,
  Tabs,
  Tooltip,
  Toast,
  computeFloatingPosition,
  readStoredAppearance,
} from '../dist/browser.js'
import { createSingleDialogLabelRegistry } from '../dist/dialog.js'

test('root entry renders on the server without browser globals', () => {
  const html = renderToString(createElement(Button, { loading: true }, 'Save'))
  assert.match(html, /aria-busy="true"/)
  assert.match(html, /disabled=""/)
  assert.match(html, />Save</)
})

test('application layout keeps one responsive landmark tree and a skip target', () => {
  const html = renderToString(
    createElement(
      AppShell,
      { header: 'Header', sidebar: 'Sidebar', mainId: 'workspace' },
      createElement(PageShell, null, createElement(PageHeader, { title: 'Resources' })),
    ),
  )
  assert.match(html, /href="#workspace"/)
  assert.match(html, /<header/)
  assert.match(html, /<main id="workspace"/)
  assert.match(html, />Sidebar</)
  assert.equal((html.match(/id="workspace"/g) ?? []).length, 1)
  assert.match(renderToString(createElement(Toolbar, { label: 'Actions' })), /role="group"/)
  assert.match(renderToString(createElement(Card, null, 'Card')), /data-variant="outline"/)
})

test('navigation emits current-page semantics without owning a router', () => {
  const html = renderToString(
    createElement(
      'div',
      null,
      createElement(Breadcrumb, {
        items: [{ label: 'Home', href: '/' }, { label: 'Resources' }],
      }),
      createElement(Pagination, { page: 2, pageCount: 5, getPageHref: (page) => `?page=${page}` }),
    ),
  )
  assert.match(html, /aria-label="Breadcrumb"/)
  assert.match(html, /aria-current="page"/)
  assert.match(html, /href="\?page=3"/)
})

test('semantic table and controlled data table render accessible state', () => {
  const columns = [
    {
      id: 'name',
      label: 'Name',
      header: 'Name',
      cell: (row) => row.name,
      sortable: true,
      priority: 'primary',
    },
    {
      id: 'status',
      label: 'Status',
      header: 'Status',
      cell: (row) => row.status,
      priority: 'secondary',
    },
  ]
  const html = renderToString(
    createElement(DataTable, {
      caption: 'Deployments',
      columns,
      rows: [{ id: 'one', name: 'Production', status: 'Ready' }],
      getRowId: (row) => row.id,
      responsiveMode: 'cards',
      sort: { columnId: 'name', direction: 'ascending' },
    }),
  )
  assert.ok(Table.Root)
  assert.match(html, /<caption[^>]*>Deployments</)
  assert.match(html, /aria-sort="ascending"/)
  assert.match(html, /data-responsive-mode="cards"/)
  assert.match(html, /cs-data-table-card-label[^>]*>Status</)
  assert.match(renderToString(createElement(EmptyState, { title: 'No resources' })), /No resources/)
  const loading = renderToString(
    createElement(DataTable, {
      caption: 'Deployments',
      columns,
      rows: [],
      getRowId: (row) => row.id,
      responsiveMode: 'scroll',
      loading: true,
      loadingLabel: 'Loading deployments',
    }),
  )
  assert.match(loading, /aria-labelledby=/)
  assert.match(loading, />Deployments</)
  assert.match(loading, /aria-label="Loading deployments"/)
})

test('floating position flips and clamps to the viewport without DOM globals', () => {
  const result = computeFloatingPosition(
    { top: 2, right: 110, bottom: 22, left: 90, width: 20, height: 20 },
    { width: 80, height: 40 },
    { width: 140, height: 100 },
    { placement: 'top', align: 'end', collisionPadding: 8 },
  )
  assert.equal(result.placement, 'bottom')
  assert.ok(result.left >= 8)
  assert.ok(result.left <= 52)
  assert.ok(result.top >= 8)
  const rtl = computeFloatingPosition(
    { top: 20, right: 50, bottom: 40, left: 20, width: 30, height: 20 },
    { width: 10, height: 10 },
    { width: 100, height: 100 },
    { placement: 'bottom', align: 'start', direction: 'rtl' },
  )
  assert.equal(rtl.left, 40)
})

test('browser compound components expose keyboard-oriented native roles during SSR', () => {
  const tabs = renderToString(
    createElement(
      Tabs.Root,
      { defaultValue: 'overview' },
      createElement(
        Tabs.List,
        null,
        createElement(Tabs.Trigger, { value: 'overview' }, 'Overview'),
        createElement(Tabs.Trigger, { value: 'activity' }, 'Activity'),
      ),
      createElement(Tabs.Content, { value: 'overview' }, 'Overview panel'),
      createElement(Tabs.Content, { value: 'activity' }, 'Activity panel'),
    ),
  )
  assert.match(tabs, /role="tablist"/)
  assert.match(tabs, /aria-selected="true"/)
  assert.match(tabs, /role="tabpanel"/)
  assert.throws(
    () =>
      renderToString(
        createElement(
          Tabs.Root,
          null,
          createElement(Tabs.List, null, createElement(Tabs.Trigger, { value: 'one' }, 'One')),
        ),
      ),
    /requires value or defaultValue/,
  )
  const tooltip = renderToString(
    createElement(
      Tooltip.Root,
      { defaultOpen: true },
      createElement(Tooltip.Trigger, { 'aria-describedby': 'existing-help' }, 'Help'),
      createElement(Tooltip.Content, null, 'Tooltip help'),
    ),
  )
  assert.match(tooltip, /aria-describedby="existing-help [^"]+-content"/)
  assert.match(
    renderToString(createElement(Toast.Root, { tone: 'danger', title: 'Failed' })),
    /role="alert"/,
  )
})

test('Core v1 manifest is publishable and keeps planned exports out of the runtime entry', async () => {
  const inventory = JSON.parse(
    await readFile(new URL('../release/component-inventory.v1.json', import.meta.url), 'utf8'),
  )
  const root = await import('../dist/index.js')
  const browser = await import('../dist/browser.js')
  for (const component of inventory.components) {
    if (
      component.status === 'core' ||
      component.status === 'preview' ||
      component.status === 'deprecated'
    ) {
      const entry = component.entrypoint === '.' ? root : browser
      assert.ok(component.export in entry, `missing implemented export: ${component.export}`)
    }
    if (component.status === 'planned') {
      const entry = component.entrypoint === '.' ? root : browser
      assert.ok(
        !(component.export in entry),
        `planned export must not ship early: ${component.export}`,
      )
    }
  }
})

test('FormField connects label, description and error semantics', () => {
  const html = renderToString(
    createElement(
      FormField,
      {
        label: 'Email',
        description: 'Work address',
        error: 'Invalid email',
        required: true,
      },
      (props) => createElement(Input, { ...props, type: 'email' }),
    ),
  )
  const id = html.match(/for="([^"]+)"/)?.[1]
  assert.ok(id)
  assert.match(html, new RegExp(`id="${id}"`))
  assert.match(html, /aria-describedby=/)
  assert.match(html, /aria-invalid="true"/)
  assert.match(html, /role="alert"/)
})

test('responsive layout serializes breakpoint values without hiding content', () => {
  const html = renderToString(createElement(Grid, { columns: { base: 1, md: 3 } }, 'Content'))
  assert.match(html, /--cs-grid-columns:1/)
  assert.match(html, /--cs-grid-columns-md:3/)
  assert.match(html, />Content</)
})

test('token source and generated stylesheet stay in exact agreement', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8')
  assert.match(
    css,
    new RegExp(`GENERATED TOKEN REPRESENTATION: src/tokens\\.ts \\(${tokenSourceId}\\)`),
  )
  for (const [name, value] of tokenDeclarations) {
    const declarations = [
      ...css.matchAll(new RegExp(`${name.replaceAll('-', '\\-')}\\s*:\\s*([^;]+);`, 'g')),
    ]
    assert.ok(declarations.length >= 1, `expected a generated declaration for ${name}`)
    assert.equal(declarations[0]?.[1]?.trim(), value, `generated base token drift for ${name}`)
  }
  assert.equal(foundationTokens.breakpoint.md, '48rem')
  for (const value of Object.values(foundationTokens.breakpoint)) {
    assert.match(css, new RegExp(`@media \\(min-width: ${value.replace('.', '\\.')}\\)`))
  }
  for (const value of Object.values(foundationTokens.containerBreakpoint)) {
    assert.match(
      css,
      new RegExp(`@container cornerstone \\(min-width: ${value.replace('.', '\\.')}\\)`),
    )
  }
})

test('invalid stored appearance falls back independently for each axis', () => {
  assert.deepEqual(
    readStoredAppearance({
      getItem: () =>
        JSON.stringify({
          theme: 'unknown',
          style: 'soft',
          brand: 'orange',
          density: 'giant',
        }),
    }),
    {
      theme: 'dark',
      style: 'soft',
      brand: 'orange',
      density: 'default',
    },
  )
})

test('appearance helpers emit and apply the four independent axes', () => {
  const appearance = resolveAppearance({
    theme: 'light',
    style: 'minimal',
    brand: 'emerald',
    density: 'comfortable',
  })
  assert.deepEqual(appearanceDataAttributes(appearance), {
    'data-theme': 'light',
    'data-style': 'minimal',
    'data-brand': 'emerald',
    'data-density': 'comfortable',
  })
  const properties = new Map()
  const element = {
    dataset: {},
    style: { setProperty: (name, value) => properties.set(name, value) },
  }
  applyAppearance(appearance, element)
  assert.deepEqual(element.dataset, appearance)
  assert.equal(properties.get('--cs-brand'), '#10b981')
})

test('custom brands require an explicit allowlist', () => {
  assert.equal(resolveAppearance({ brand: 'project-blue' }).brand, 'signal-violet')
  assert.equal(
    resolveAppearance({ brand: 'project-blue' }, undefined, { allowedBrands: ['project-blue'] })
      .brand,
    'project-blue',
  )
})

test('custom brand definitions are safe, immutable and presentation-ready', () => {
  const brand = defineBrand({
    name: 'project-blue',
    accent: '#1357c5',
    contrast: '#ffffff',
    theme: { dark: { focus: '#88b4ff' } },
  })
  const registry = createAppearanceRegistry([brand])
  assert.equal(Object.isFrozen(registry), true)
  assert.equal(Object.isFrozen(registry.definitions['project-blue']), true)
  assert.equal(Object.isFrozen(registry.definitions['project-blue'].theme.dark), true)
  const appearance = registry.resolve({ brand: 'project-blue', theme: 'dark' })
  assert.equal(appearance.brand, 'project-blue')
  assert.deepEqual(appearancePresentation(appearance, registry).style, {
    '--cs-brand': '#1357c5',
    '--cs-brand-contrast': '#ffffff',
    '--cs-focus': '#88b4ff',
  })
  const properties = new Map()
  applyAppearance(
    appearance,
    { dataset: {}, style: { setProperty: (name, value) => properties.set(name, value) } },
    registry,
  )
  assert.equal(properties.get('--cs-brand'), '#1357c5')
  assert.equal(
    readStoredAppearance(
      { getItem: () => JSON.stringify({ brand: 'project-blue' }) },
      undefined,
      undefined,
      registry,
    ).brand,
    'project-blue',
  )
  assert.throws(() => defineBrand({ name: 'orange', accent: '#000', contrast: '#fff' }))
  assert.throws(() => defineBrand({ name: 'unsafe brand', accent: '#000', contrast: '#fff' }))
  assert.throws(() => defineBrand({ name: 'low-contrast', accent: '#8b5cf6', contrast: '#fff' }))
})

test('container-responsive grid values and closed grid measures serialize predictably', () => {
  const html = renderToString(
    createElement(Grid, { containerColumns: { base: 1, regular: 3, wide: 4 } }, 'Content'),
  )
  const measureHtml = renderToString(createElement(Grid, { minItemWidth: 'md' }, 'Content'))
  assert.match(html, /--cs-grid-container-columns:1/)
  assert.match(html, /--cs-grid-container-columns-regular:3/)
  assert.match(measureHtml, /--cs-grid-min:var\(--cs-grid-measure-md\)/)
})

test('Portal renders no server markup before hydration', () => {
  assert.equal(renderToString(createElement(Portal, null, 'Overlay')), '')
})

test('Dialog label registry rejects duplicate instances even with the same id', () => {
  const registry = createSingleDialogLabelRegistry('Dialog.Title')
  const unregister = registry.register('shared-id')
  assert.throws(() => registry.register('shared-id'), /must be unique/)
  unregister()
  assert.doesNotThrow(() => registry.register('shared-id'))
})

test('selection and dialog primitives expose native accessible semantics', () => {
  const html = renderToString(
    createElement(
      DialogSurface,
      { title: 'Settings', description: 'Choose preferences' },
      createElement(Checkbox, { label: 'Email alerts' }),
      createElement(Switch, { label: 'Dark mode', defaultChecked: true }),
    ),
  )
  assert.match(html, /role="dialog"/)
  assert.match(html, /aria-modal="true"/)
  assert.match(html, /type="checkbox"/)
  assert.match(html, /role="switch"/)
})

test('Progress clamps non-finite values and invalid maximums', () => {
  const html = renderToString(
    createElement(Progress, { value: Number.POSITIVE_INFINITY, max: 0, label: 'Upload' }),
  )
  assert.match(html, /aria-valuemax="100"/)
  assert.match(html, /aria-valuenow="0"/)
  assert.doesNotMatch(html, /Infinity|NaN/)
})
