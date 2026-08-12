import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const packageRoot = resolve(import.meta.dirname, '..')
const source = resolve(packageRoot, '..', '..', 'templates', 'canonical')
const target = resolve(packageRoot, 'dist', 'templates', 'canonical')

if (!target.startsWith(resolve(packageRoot, 'dist'))) {
  throw new Error('Refusing to write templates outside package dist')
}
rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
cpSync(source, target, { recursive: true, dereference: false, errorOnExist: false })
