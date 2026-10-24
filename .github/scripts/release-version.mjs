import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// Numeric SemVer fields cannot contain leading zeroes. Use UTC for every runner.
export function releaseVersion(date, runNumber) {
  if (!Number.isSafeInteger(runNumber) || runNumber < 1) throw new Error('Invalid run number')
  const stamp = date.toISOString().replace(/[-:]/g, '')
  return `${stamp.slice(0, 8)}.${Number(stamp.slice(9, 15))}.${runNumber}`
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = process.env.RELEASE_VERSION || releaseVersion(new Date(), Number(process.env.GITHUB_RUN_NUMBER))
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error('Invalid release version')
  const manifest = JSON.parse(readFileSync('plugin.json', 'utf8'))
  manifest.version = version
  writeFileSync('plugin.json', `${JSON.stringify(manifest, null, 2)}\n`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\ntag=v${version}\n`)
  console.log(version)
}
