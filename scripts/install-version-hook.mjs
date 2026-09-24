import { chmodSync, lstatSync, readlinkSync, symlinkSync, unlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

// Point .git/hooks/pre-commit at the repo hook. Cursor's own hooks directory
// still runs this file, because it dispatches to the checkout's hook first.
let root
let hooksDir
try {
  root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  // --git-path hooks follows core.hooksPath. That directory may belong to the
  // editor, so always install into this checkout's own .git/hooks.
  const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], { encoding: 'utf8' }).trim()
  hooksDir = resolve(root, gitDir, 'hooks')
} catch {
  process.exit(0)
}

const source = resolve(root, '.githooks/pre-commit')
const dest = resolve(hooksDir, 'pre-commit')
chmodSync(source, 0o755)

try {
  const existing = lstatSync(dest)
  if (existing.isSymbolicLink() && readlinkSync(dest) === source) process.exit(0)
  if (!existing.isSymbolicLink()) {
    console.log('Left the existing pre-commit hook in place. Chain .githooks/pre-commit so Settings version still bumps.')
    process.exit(0)
  }
  unlinkSync(dest)
} catch (error) {
  if (error && error.code !== 'ENOENT') throw error
}

symlinkSync(source, dest)
console.log('Installed Settings version pre-commit hook')
