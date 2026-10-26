import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { releaseVersion } from './release-version.mjs'

test('release packager and backend use the same pinned SDK revision', () => {
  const cargo = readFileSync('backend/Cargo.toml', 'utf8')
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
  const backend = cargo.match(/^gateway-plugin-sdk = \{[^\n]*rev = "([a-f0-9]{40})"/m)
  const packager = workflow.match(/^  SDK_REV: ([a-f0-9]{40})$/m)
  assert.ok(backend, 'Backend must pin the SDK to a full commit')
  assert.ok(packager, 'Release workflow must pin the official packager source')
  assert.equal(packager[1], backend[1])
})

test('release notes identify the source baseline and matching host compatibility', () => {
  const manifest = JSON.parse(readFileSync('plugin.json', 'utf8'))
  const frontend = JSON.parse(readFileSync('frontend/package.json', 'utf8'))
  const cargo = readFileSync('backend/Cargo.toml', 'utf8')
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
  const notes = readFileSync(`docs/releases/v${manifest.version}.md`, 'utf8')
  assert.equal(frontend.version, manifest.version)
  assert.equal(cargo.match(/^version = "([^"]+)"/m)[1], manifest.version)
  for (const text of [workflow, notes]) {
    assert.ok(text.includes(`源码基线：v${manifest.version}`))
    assert.ok(text.includes('对应宿主：RS v3.33.0'))
    assert.ok(text.includes(manifest.engines['codex-proxy-rs']))
    assert.ok(text.includes('RPC v7'))
  }
})

test('UTC timestamp is numeric SemVer, including midnight and January', () => {
  assert.equal(releaseVersion(new Date('2026-01-02T00:00:01Z'), 3), '20260102.1.3')
  assert.equal(releaseVersion(new Date('2026-10-24T19:30:59+09:00'), 42), '20261024.103059.42')
  assert.equal(releaseVersion(new Date('2026-10-24T00:00:00Z'), 42), '20261024.0.42')
  assert.throws(() => releaseVersion(new Date(), NaN))
  assert.throws(() => releaseVersion(new Date(), 0))
})

test('matrix jobs stamp the same version and preserve plugin identity and state', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'quota-release-'))
  try {
    const manifest = JSON.parse(readFileSync('plugin.json', 'utf8'))
    writeFileSync(join(cwd, 'plugin.json'), JSON.stringify(manifest))
    const output = join(cwd, 'output')
    const result = spawnSync(process.execPath, [resolve('.github/scripts/release-version.mjs')], {
      cwd, encoding: 'utf8', env: { ...process.env, RELEASE_VERSION: '20261024.103059.42', GITHUB_OUTPUT: output },
    })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(readFileSync(join(cwd, 'plugin.json'), 'utf8')), { ...manifest, version: '20261024.103059.42' })
    assert.equal(readFileSync(output, 'utf8'), 'version=20261024.103059.42\ntag=v20261024.103059.42\n')
    const invalid = spawnSync(process.execPath, [resolve('.github/scripts/release-version.mjs')], {
      cwd, env: { ...process.env, RELEASE_VERSION: '20261024.001.42' },
    })
    assert.notEqual(invalid.status, 0)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
