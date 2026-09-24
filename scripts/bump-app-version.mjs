import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const VERSION_RE = /"version": "(\d+\.\d+\.\d+)"/

function readVersion(text, label) {
  const match = text.match(VERSION_RE)
  if (!match) throw new Error(`${label} has no x.y.z version`)
  return match[1]
}

function bumpPatch(version) {
  const [major, minor, patch] = version.split('.').map((part) => Number(part))
  return `${major}.${minor}.${patch + 1}`
}

function replacePackageVersion(text, next) {
  const match = text.match(VERSION_RE)
  if (!match) throw new Error('package.json has no x.y.z version')
  return text.replace(VERSION_RE, `"version": "${next}"`)
}

function lockIdentityVersions(text) {
  return [...text.matchAll(/"name": "podcastskip",\n( +)"version": "(\d+\.\d+\.\d+)"/g)].map((match) => match[2])
}

function replaceLockVersion(text, next) {
  let replaced = 0
  const updated = text.replace(/"name": "podcastskip",\n( +)"version": "\d+\.\d+\.\d+"/g, (_full, spaces) => {
    replaced += 1
    return `"name": "podcastskip",\n${spaces}"version": "${next}"`
  })
  if (replaced !== 2) {
    throw new Error(`expected 2 podcastskip versions in package-lock.json, updated ${replaced}`)
  }
  return updated
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function stagedNames() {
  return git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean)
}

function syncLockfile(version) {
  const path = 'package-lock.json'
  const current = readFileSync(path, 'utf8')
  const identities = lockIdentityVersions(current)
  if (identities.length === 2 && identities.every((value) => value === version)) return false
  writeFileSync(path, replaceLockVersion(current, version))
  git(['add', '--', path])
  return true
}

function selfTest() {
  if (bumpPatch('0.2.1') !== '0.2.2') throw new Error('patch bump failed')
  if (bumpPatch('1.9.9') !== '1.9.10') throw new Error('double-digit patch bump failed')
  const pkg = readFileSync('package.json', 'utf8')
  const from = readVersion(pkg, 'package.json')
  const next = bumpPatch(from)
  const bumpedPkg = replacePackageVersion(pkg, next)
  if (readVersion(bumpedPkg, 'bumped package.json') !== next) throw new Error('package.json version was not replaced')
  if (bumpedPkg.includes(`"version": "${from}"`)) throw new Error('old package.json version remained')
  const bumpedLock = replaceLockVersion(readFileSync('package-lock.json', 'utf8'), next)
  JSON.parse(bumpedPkg)
  JSON.parse(bumpedLock)
  const identities = lockIdentityVersions(bumpedLock)
  if (identities.length !== 2 || identities.some((value) => value !== next)) {
    throw new Error(`lockfile versions were ${identities.join(', ')}`)
  }
  console.log('bump-app-version: self-test OK')
}

function main() {
  if (stagedNames().length === 0) return

  const headVersion = readVersion(git(['show', 'HEAD:package.json']), 'HEAD package.json')
  const names = stagedNames()
  let committedVersion = headVersion

  if (names.includes('package.json')) {
    committedVersion = readVersion(git(['show', ':package.json']), 'staged package.json')
  } else {
    const workVersion = readVersion(readFileSync('package.json', 'utf8'), 'package.json')
    if (workVersion !== headVersion) committedVersion = workVersion
  }

  if (committedVersion !== headVersion) {
    if (!names.includes('package.json')) {
      writeFileSync('package.json', replacePackageVersion(readFileSync('package.json', 'utf8'), committedVersion))
      git(['add', '--', 'package.json'])
    }
    syncLockfile(committedVersion)
    return
  }

  const next = bumpPatch(headVersion)
  writeFileSync('package.json', replacePackageVersion(readFileSync('package.json', 'utf8'), next))
  writeFileSync('package-lock.json', replaceLockVersion(readFileSync('package-lock.json', 'utf8'), next))
  git(['add', '--', 'package.json', 'package-lock.json'])
  console.log(`Settings version ${headVersion} → ${next}`)
}

if (process.argv.includes('--self-test')) {
  selfTest()
} else {
  main()
}
