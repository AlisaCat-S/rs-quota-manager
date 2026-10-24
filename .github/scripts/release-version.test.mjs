import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { releaseVersion } from './release-version.mjs'

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
