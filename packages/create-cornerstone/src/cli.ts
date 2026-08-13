#!/usr/bin/env node
import { createInterface } from 'node:readline/promises'
import { basename, resolve } from 'node:path'
import {
  createProject,
  createProjectFromManifest,
  generateScaffold,
  planProject,
  planProjectUpdate,
  readManifest,
  resolveManifest,
  verifyProject,
  updateProject,
} from './index.js'
import { scaffoldKindSchema } from './scaffold/registry.js'

const args = process.argv.slice(2)
const command = args.shift()

try {
  if (command === 'plan') {
    if (args.includes('--manifest')) {
      const manifestPath = option(args, '--manifest')
      console.log(
        JSON.stringify(planProject(resolveManifest(await readManifest(manifestPath))), null, 2),
      )
    } else {
      const target = positional(args)
      if (!args.includes('--dry-run')) usage()
      console.log(JSON.stringify(await planProjectUpdate(target), null, 2))
    }
  } else if (command === 'create') {
    const target = positional(args)
    const manifestPath = optionalOption(args, '--manifest')
    const lock = manifestPath
      ? await createProject(target, manifestPath)
      : await createProjectFromManifest(target, await promptManifest(target))
    console.log(
      lock.schemaVersion === 2
        ? `Created ${lock.resolved.name} (${lock.resolved.profile} supported preview; not certified)`
        : `Created ${lock.resolved.name} (${lock.resolved.profile})`,
    )
  } else if (command === 'verify') {
    const target = positional(args)
    const lock = await verifyProject(target)
    console.log(
      lock.schemaVersion === 2
        ? `Verified ${lock.resolved.name} (supported preview; not certified)`
        : `Verified ${lock.resolved.name}`,
    )
  } else if (command === 'update') {
    const target = positional(args)
    const dryRun = args.includes('--dry-run')
    const plan = await updateProject(target, { dryRun })
    console.log(JSON.stringify(plan, null, 2))
    if (!dryRun) console.error(`Updated ${target} to template ${plan.toTemplateVersion}`)
  } else if (command === 'generate') {
    const generated = parseGenerateArguments(args)
    const { kindInput, name, target, dryRun, timestamp } = generated
    const kind = scaffoldKindSchema.parse(kindInput)
    const plan = await generateScaffold(target, kind, name, {
      dryRun,
      ...(timestamp === undefined ? {} : { timestamp }),
    })
    console.log(JSON.stringify(plan, null, 2))
    if (!dryRun) console.error(`Generated ${plan.scaffold.id} in ${target}`)
  } else {
    usage()
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

function parseGenerateArguments(args: string[]): {
  kindInput: string
  name: string
  target: string
  dryRun: boolean
  timestamp?: string
} {
  const [kindInput, name, ...rest] = args
  if (!kindInput || !name || kindInput.startsWith('--') || name.startsWith('--')) usage()
  const values = new Map<string, string | true>()
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index]!
    if (!['--target', '--timestamp', '--dry-run'].includes(argument) || values.has(argument)) {
      usage()
    }
    if (argument === '--dry-run') {
      values.set(argument, true)
      continue
    }
    const value = rest[index + 1]
    if (!value || value.startsWith('--')) usage()
    values.set(argument, value)
    index += 1
  }
  const target = values.get('--target')
  if (typeof target !== 'string') usage()
  const timestamp = values.get('--timestamp')
  return {
    kindInput,
    name,
    target,
    dryRun: values.get('--dry-run') === true,
    ...(typeof timestamp === 'string' ? { timestamp } : {}),
  }
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

function optionalOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (!value) usage()
  return value
}

async function promptManifest(target: string) {
  const suggestedName = basename(resolve(target))
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')

  if (!process.stdin.isTTY) {
    process.stdin.setEncoding('utf8')
    let content = ''
    for await (const chunk of process.stdin) content += chunk
    const [name = '', profile = '', license = ''] = content.split(/\r?\n/)
    return promptAnswers(suggestedName, name, profile, license)
  }

  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return promptAnswers(
      suggestedName,
      await prompt.question(`Project name [${suggestedName}]: `),
      await prompt.question('Profile [minimal]: '),
      await prompt.question('License (ISC/MIT/UNLICENSED) [UNLICENSED]: '),
    )
  } finally {
    prompt.close()
  }
}

function promptAnswers(
  suggestedName: string,
  nameInput: string,
  profileInput: string,
  licenseInput: string,
) {
  return {
    schemaVersion: 1,
    name: nameInput.trim() || suggestedName,
    profile: profileInput.trim() || 'minimal',
    capabilities: [],
    license: licenseInput.trim().toUpperCase() || 'UNLICENSED',
    providers: {},
  }
}

function usage(): never {
  console.error(
    'Usage:\n  create-cornerstone plan --manifest <file>\n  create-cornerstone plan <target> --dry-run\n  create-cornerstone create <target> [--manifest <file>]\n  create-cornerstone update <target> [--dry-run]\n  create-cornerstone generate <package|feature|api|migration> <name> --target <project> [--timestamp <13-digit>] [--dry-run]\n  create-cornerstone verify <target>',
  )
  process.exit(2)
}
