// Guidance gate for the `skill:new` scaffold.
//
// The scaffold used to print "no manual edits required", which was false:
// README documents TWO edits for a new skill (the SKILL.md the scaffold
// writes, and one entry in assets/skill-contracts.json), and
// skill-contracts.test.mjs fails the whole suite until the contract exists.
// A scaffold that reports completion while the tree is red is the same
// false-completion class the 0.2.1 release review fixed in verify-live.sh.
//
// This gate runs the REAL script against a throwaway copy of the repo and
// asserts both halves of the truth:
//   1. the script's own closing message names the remaining manual edit;
//   2. the contract gate really does fail without that edit (so the message
//      is not advice about a check that does not exist).

import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PROBE = 'gate-probe-skill'

let failures = 0
const check = (label, cond, detail) => {
  if (cond) console.log(`PASS ${label}`)
  else { failures += 1; console.log(`FAIL ${label} :: ${detail ?? ''}`) }
}

// A throwaway tree that keeps the scaffold hermetic: it must not touch the
// real checkout (the scaffold writes into assets/skills/ and regenerates the
// README), and it must not need the host packages, so node_modules is left out.
function makeCopy() {
  const dir = mkdtempSync(join(tmpdir(), 'skill-new-'))
  for (const entry of ['assets', 'lib', 'scripts', 'tests']) {
    cpSync(join(PLUGIN_ROOT, entry), join(dir, entry), { recursive: true })
  }
  cpSync(join(PLUGIN_ROOT, 'package.json'), join(dir, 'package.json'))
  cpSync(join(PLUGIN_ROOT, 'README.md'), join(dir, 'README.md'))
  return dir
}

const copy = makeCopy()
try {
  const run = spawnSync('node', [join(copy, 'scripts', 'new-skill.mjs'), PROBE], {
    cwd: copy,
    encoding: 'utf8',
  })
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
  check('scaffold exits 0', run.status === 0, `status=${run.status} ${output.slice(0, 200)}`)
  check('scaffold message names the remaining manual edit',
    output.includes('skill-contracts.json'),
    `message was: ${JSON.stringify(output.slice(-160))}`)
  check('scaffold message does not claim "no manual edits required"',
    !output.includes('no manual edits required'),
    'the false-completion sentence is still printed')

  const contractGate = spawnSync('node', [join(copy, 'tests', 'skill-contracts.test.mjs')], {
    cwd: copy,
    encoding: 'utf8',
  })
  check('the contract gate fails without the contract entry (message is load-bearing)',
    contractGate.status !== 0,
    `contract gate exited ${contractGate.status} — the message would be advice about nothing`)
  const contractOut = `${contractGate.stdout ?? ''}${contractGate.stderr ?? ''}`
  check('the contract gate names the missing skill',
    contractOut.includes(PROBE),
    contractOut.slice(0, 200))
} finally {
  rmSync(copy, { recursive: true, force: true })
}

console.log(`\nfailures=${failures}`)
if (failures > 0) { console.log('new-skill guidance gate FAIL'); process.exit(1) }
console.log('new-skill guidance gate PASS')
