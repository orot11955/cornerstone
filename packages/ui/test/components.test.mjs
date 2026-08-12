import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import {
  Button,
  Checkbox,
  DialogSurface,
  FormField,
  Grid,
  Input,
  Progress,
  Switch,
  appearanceDataAttributes,
  resolveAppearance,
} from '../dist/index.js'
import { applyAppearance, readStoredAppearance } from '../dist/browser.js'

test('root entry renders on the server without browser globals', () => {
  const html = renderToString(createElement(Button, { loading: true }, 'Save'))
  assert.match(html, /aria-busy="true"/)
  assert.match(html, /disabled=""/)
  assert.match(html, />Save</)
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
  const element = { dataset: {} }
  applyAppearance(appearance, element)
  assert.deepEqual(element.dataset, appearance)
})

test('custom brands require an explicit allowlist', () => {
  assert.equal(resolveAppearance({ brand: 'project-blue' }).brand, 'signal-violet')
  assert.equal(
    resolveAppearance({ brand: 'project-blue' }, undefined, { allowedBrands: ['project-blue'] })
      .brand,
    'project-blue',
  )
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
