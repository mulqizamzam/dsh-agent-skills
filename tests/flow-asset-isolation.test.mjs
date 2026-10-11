// Asset-isolation gate for plugin activation.
//
// The orchestrator spec's activation contract: "A malformed definition or
// contract registry leaves the engine unavailable: the nine alias commands
// (which share nothing with the workflow layer) still register, and /flow
// stays registered while reporting which file and which rule failed."
//
// That try/catch around createEngineLoader had no coverage: deleting it left
// the whole suite green (verified — the mutant that removes it registers 9
// commands and no /flow only when an asset is actually broken, and no gate
// ever broke one through apply()). This gate breaks one on a throwaway copy
// and asserts the documented behaviour through the REAL apply().
//
// Runs on a copy because apply() derives its asset paths from its own
// location: corrupting the shipped files in the checkout would be the defect
// this gate exists to prevent. node_modules is copied with verbatimSymlinks
// so the host package links stay links.

import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

let failures = 0
const check = (label, cond, detail) => {
  if (cond) console.log(`PASS ${label}`)
  else { failures += 1; console.log(`FAIL ${label} :: ${detail ?? ''}`) }
}

const copy = mkdtempSync(join(tmpdir(), 'asset-isolation-'))
try {
  for (const entry of ['assets', 'lib', 'scripts', 'tests', 'node_modules']) {
    cpSync(join(PLUGIN_ROOT, entry), join(copy, entry), { recursive: true, verbatimSymlinks: true })
  }
  cpSync(join(PLUGIN_ROOT, 'package.json'), join(copy, 'package.json'))
  cpSync(join(PLUGIN_ROOT, 'README.md'), join(copy, 'README.md'))

  // Break the contract registry the way a typo would: unparseable JSON.
  writeFileSync(join(copy, 'assets', 'skill-contracts.json'), '{ "skills": { oops')

  const mod = await import(pathToFileURL(join(copy, 'lib', 'index.js')).href)
  const registered = []
  const ctx = {
    commands: { register: (d) => { registered.push(d); return () => {} } },
    skills: {
      get: async (name) => (name === 'spec-driven-development'
        ? {
            name,
            provider: 'agent-skills',
            description: 'x',
            invocation: { modelInvocable: true, userInvocable: true },
            content: 'BODY',
            path: join(copy, 'assets', 'skills', name, 'SKILL.md'),
          }
        : undefined),
    },
  }

  let threw = null
  try { mod.apply(ctx) } catch (error) { threw = error }
  check('a broken asset does not throw out of apply()', threw === null, threw?.message ?? 'threw')
  check('all ten commands still register (9 aliases + degraded /flow)',
    registered.length === 10, `got ${registered.length}`)
  check('/flow is still registered', registered.some((r) => r.name === 'flow'))

  const flow = registered.find((r) => r.name === 'flow')
  const steered = []
  const flowResult = await flow.handler({
    agent: { steer: (m) => steered.push(m), session: { header: { cwd: copy } } },
    rawInput: 'implement OAuth login',
    signal: new AbortController().signal,
    commandId: 'isolation-test',
    attachments: [],
  })
  check('/flow reports the broken asset instead of steering',
    flowResult?.kind === 'error' && /skill-contracts/.test(flowResult.text ?? ''),
    JSON.stringify(flowResult).slice(0, 200))
  check('nothing was steered by the degraded /flow', steered.length === 0, `got ${steered.length}`)

  const spec = registered.find((r) => r.name === 'spec')
  const specResult = await spec.handler({
    agent: { steer: () => {} }, rawInput: 'x',
    signal: new AbortController().signal, commandId: 'isolation-test-2', attachments: [],
  })
  check('an alias still works while the workflow layer is degraded',
    specResult?.kind === 'success', JSON.stringify(specResult).slice(0, 160))
} finally {
  rmSync(copy, { recursive: true, force: true })
}

console.log(`\nfailures=${failures}`)
if (failures > 0) { console.log('asset isolation gate FAIL'); process.exit(1) }
console.log('asset isolation gate PASS')
