import { gzipSync } from 'node:zlib'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const buildDirectory = join(root, 'apps/web/.next')
const staticDirectory = join(buildDirectory, 'static')
const outputPath = join(root, '.artifacts/web-performance-budget.json')
const limits = {
  javascriptGzipBytes: 180 * 1024,
  cssGzipBytes: 60 * 1024,
  fontBytes: 100 * 1024,
}

if (!existsSync(join(buildDirectory, 'BUILD_ID'))) {
  fail('Web build output is missing. Run pnpm --filter web build first.')
}

const buildManifest = readJson(join(buildDirectory, 'build-manifest.json'))
const clientManifestPath = join(buildDirectory, 'server/app/page_client-reference-manifest.js')
const clientManifest = readFileSync(clientManifestPath, 'utf8')
const javascriptFiles = new Set([
  ...buildManifest.rootMainFiles,
  ...extractFiles(clientManifest, /static\/chunks\/[^"']+\.js/g),
])
const cssFiles = new Set(extractFiles(clientManifest, /static\/css\/[^"']+\.css/g))
const fontFiles = walk(staticDirectory).filter((file) => /\.(woff2?|ttf|otf)$/i.test(file))

const javascript = measureCompressed(javascriptFiles)
const css = measureCompressed(cssFiles)
const fonts = measureRaw(fontFiles)
const report = {
  generatedAt: new Date().toISOString(),
  route: '/',
  budgets: limits,
  actual: {
    javascriptGzipBytes: javascript.total,
    cssGzipBytes: css.total,
    fontBytes: fonts.total,
  },
  files: {
    javascript: javascript.files,
    css: css.files,
    fonts: fonts.files,
  },
}

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`)

const failures = Object.entries(report.actual).filter(([name, value]) => value > limits[name])
console.log(`[web-budget] ${relative(root, outputPath)}`)
for (const [name, value] of Object.entries(report.actual)) {
  console.log(`  ${name}: ${formatBytes(value)} / ${formatBytes(limits[name])}`)
}
if (failures.length > 0) {
  fail(`Performance budget exceeded: ${failures.map(([name]) => name).join(', ')}`)
}

function extractFiles(source, pattern) {
  return [...source.matchAll(pattern)].map(([value]) => value)
}

function measureCompressed(files) {
  const values = [...files].map((file) => {
    const contents = readFileSync(join(buildDirectory, file))
    return { path: file, bytes: gzipSync(contents).byteLength }
  })
  return { total: values.reduce((sum, file) => sum + file.bytes, 0), files: values }
}

function measureRaw(files) {
  const values = files.map((file) => ({
    path: relative(buildDirectory, file),
    bytes: statSync(file).size,
  }))
  return { total: values.reduce((sum, file) => sum + file.bytes, 0), files: values }
}

function walk(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  })
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function formatBytes(value) {
  return `${(value / 1024).toFixed(1)} KiB`
}

function fail(message) {
  console.error(`[web-budget] ${message}`)
  process.exit(1)
}
