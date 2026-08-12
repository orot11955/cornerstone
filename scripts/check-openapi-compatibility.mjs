import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const currentPath = resolve(root, 'apps/api/openapi/openapi.json')
const baselinePath = resolve(root, 'apps/api/openapi/releases/1.0.0.json')
const command = process.argv[2] ?? 'check'

if (command === 'update-baseline') {
  mkdirSync(dirname(baselinePath), { recursive: true })
  writeFileSync(baselinePath, readFileSync(currentPath))
  console.log('OpenAPI v1 compatibility baseline updated')
} else if (command === 'check') {
  selfTest()
  const errors = checkCompatibility(readJson(baselinePath), readJson(currentPath))
  if (errors.length > 0) {
    console.error(errors.join('\n'))
    process.exit(1)
  }
  console.log('OpenAPI compatibility check: OK')
} else {
  console.error('Expected check or update-baseline')
  process.exit(1)
}

export function checkCompatibility(previous, current) {
  const errors = []
  const methods = ['delete', 'get', 'patch', 'post', 'put']

  for (const [path, previousPath] of Object.entries(previous.paths ?? {})) {
    const currentPath = current.paths?.[path]
    if (!currentPath) {
      errors.push(`Removed path: ${path}`)
      continue
    }
    for (const method of methods) {
      const previousOperation = previousPath?.[method]
      if (!previousOperation) continue
      const currentOperation = currentPath?.[method]
      const location = `${method.toUpperCase()} ${path}`
      if (!currentOperation) {
        errors.push(`Removed operation: ${location}`)
        continue
      }
      compareValue(
        previousOperation.operationId,
        currentOperation.operationId,
        `${location} operationId`,
        errors,
      )
      compareValue(
        previousOperation.security ?? null,
        currentOperation.security ?? null,
        `${location} security`,
        errors,
      )
      compareValue(
        previousOperation['x-cornerstone-authorization'] ?? null,
        currentOperation['x-cornerstone-authorization'] ?? null,
        `${location} authorization`,
        errors,
      )
      compareParameters(
        previousOperation.parameters ?? [],
        currentOperation.parameters ?? [],
        location,
        errors,
      )
      compareRequestBody(
        previousOperation.requestBody,
        currentOperation.requestBody,
        location,
        errors,
      )
      for (const [status, previousResponse] of Object.entries(previousOperation.responses ?? {})) {
        const currentResponse = currentOperation.responses?.[status]
        if (!currentResponse) {
          errors.push(`Removed response ${status}: ${location}`)
          continue
        }
        compareContent(
          previousResponse.content,
          currentResponse.content,
          `${location} response ${status}`,
          errors,
        )
      }
    }
  }

  for (const [name, previousSchema] of Object.entries(previous.components?.schemas ?? {})) {
    const currentSchema = current.components?.schemas?.[name]
    if (!currentSchema) {
      errors.push(`Removed schema: ${name}`)
      continue
    }
    compareSchema(previousSchema, currentSchema, `schema ${name}`, errors)
  }
  return errors
}

function compareParameters(previous, current, location, errors) {
  const previousMap = new Map(previous.map((item) => [`${item.in}:${item.name}`, item]))
  const currentMap = new Map(current.map((item) => [`${item.in}:${item.name}`, item]))
  for (const [key, previousParameter] of previousMap) {
    const currentParameter = currentMap.get(key)
    if (!currentParameter) {
      errors.push(`Removed parameter ${key}: ${location}`)
      continue
    }
    compareValue(
      previousParameter.required ?? false,
      currentParameter.required ?? false,
      `${location} parameter ${key} required`,
      errors,
    )
    compareSchema(
      previousParameter.schema ?? {},
      currentParameter.schema ?? {},
      `${location} parameter ${key}`,
      errors,
    )
  }
  for (const [key, currentParameter] of currentMap) {
    if (!previousMap.has(key) && currentParameter.required) {
      errors.push(`Added required parameter ${key}: ${location}`)
    }
  }
}

function compareRequestBody(previous, current, location, errors) {
  if (!previous && current?.required) {
    errors.push(`Added required request body: ${location}`)
    return
  }
  if (previous && !current) {
    errors.push(`Removed request body contract: ${location}`)
    return
  }
  if (!previous || !current) return
  compareValue(
    previous.required ?? false,
    current.required ?? false,
    `${location} request body required`,
    errors,
  )
  compareContent(previous.content, current.content, `${location} request body`, errors)
}

function compareContent(previous, current, location, errors) {
  for (const [contentType, previousMedia] of Object.entries(previous ?? {})) {
    const currentMedia = current?.[contentType]
    if (!currentMedia) {
      errors.push(`Removed content type ${contentType}: ${location}`)
      continue
    }
    compareSchema(
      previousMedia.schema ?? {},
      currentMedia.schema ?? {},
      `${location} ${contentType}`,
      errors,
    )
  }
}

function compareSchema(previous, current, location, errors) {
  for (const key of [
    '$ref',
    'type',
    'format',
    'nullable',
    'readOnly',
    'writeOnly',
    'additionalProperties',
    'minimum',
    'maximum',
    'minLength',
    'maxLength',
    'pattern',
  ]) {
    compareValue(previous?.[key] ?? null, current?.[key] ?? null, `${location} ${key}`, errors)
  }
  compareValue(previous?.enum ?? null, current?.enum ?? null, `${location} enum`, errors)
  compareValue(previous?.required ?? [], current?.required ?? [], `${location} required`, errors)

  for (const [name, previousProperty] of Object.entries(previous?.properties ?? {})) {
    const currentProperty = current?.properties?.[name]
    if (!currentProperty) {
      errors.push(`Removed property ${name}: ${location}`)
      continue
    }
    compareSchema(previousProperty, currentProperty, `${location}.${name}`, errors)
  }
  if (previous?.items || current?.items) {
    compareSchema(previous?.items ?? {}, current?.items ?? {}, `${location} items`, errors)
  }
  for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
    const previousVariants = previous?.[keyword] ?? []
    const currentVariants = current?.[keyword] ?? []
    if (previousVariants.length !== currentVariants.length) {
      errors.push(`Changed ${keyword} variant count: ${location}`)
      continue
    }
    previousVariants.forEach((variant, index) =>
      compareSchema(variant, currentVariants[index], `${location} ${keyword}[${index}]`, errors),
    )
  }
}

function compareValue(previous, current, location, errors) {
  if (stable(previous) !== stable(current)) errors.push(`Changed ${location}`)
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (typeof value !== 'object' || value === null) return JSON.stringify(value)
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
    .join(',')}}`
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function selfTest() {
  const baseline = {
    paths: {
      '/users': {
        get: {
          operationId: 'listUsers',
          security: [],
          parameters: [],
          responses: {
            200: {
              content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        User: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      },
    },
  }
  if (checkCompatibility(baseline, structuredClone(baseline)).length !== 0) {
    throw new Error('OpenAPI compatibility self-test rejected an identical contract')
  }
  const removed = structuredClone(baseline)
  delete removed.paths['/users']
  const tightened = structuredClone(baseline)
  tightened.paths['/users'].get.parameters.push({
    in: 'query',
    name: 'scope',
    required: true,
    schema: { type: 'string' },
  })
  const changed = structuredClone(baseline)
  changed.components.schemas.User.properties.id.type = 'number'
  if (
    !checkCompatibility(baseline, removed).some((item) => item.includes('Removed path')) ||
    !checkCompatibility(baseline, tightened).some((item) =>
      item.includes('Added required parameter'),
    ) ||
    !checkCompatibility(baseline, changed).some((item) => item.includes('type'))
  ) {
    throw new Error('OpenAPI compatibility self-test did not detect a breaking change')
  }
}
