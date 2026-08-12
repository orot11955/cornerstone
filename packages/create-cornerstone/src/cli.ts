#!/usr/bin/env node
import {
  createProject,
  planProject,
  readManifest,
  resolveManifest,
  verifyProject,
} from './index.js'

const args = process.argv.slice(2)
const command = args.shift()

try {
  if (command === 'plan') {
    const manifestPath = option(args, '--manifest')
    console.log(
      JSON.stringify(planProject(resolveManifest(await readManifest(manifestPath))), null, 2),
    )
  } else if (command === 'create') {
    const target = positional(args)
    const manifestPath = option(args, '--manifest')
    const lock = await createProject(target, manifestPath)
    console.log(`Created ${lock.resolved.name} (${lock.resolved.profile})`)
  } else if (command === 'verify') {
    const target = positional(args)
    const lock = await verifyProject(target)
    console.log(`Verified ${lock.resolved.name}`)
  } else {
    usage()
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

function positional(args: string[]): string {
  const value = args.find((argument) => !argument.startsWith('--'))
  if (!value) usage()
  return value
}

function option(args: string[], name: string): string {
  const index = args.indexOf(name)
  const value = args[index + 1]
  if (index < 0 || !value) usage()
  return value
}

function usage(): never {
  console.error(
    'Usage:\n  create-cornerstone plan --manifest <file>\n  create-cornerstone create <target> --manifest <file>\n  create-cornerstone verify <target>',
  )
  process.exit(2)
}
