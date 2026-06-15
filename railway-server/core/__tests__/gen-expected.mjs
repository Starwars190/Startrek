/**
 * gen-expected.mjs  —  one-shot script to populate the "expected" field in
 * each fixture by running the trusted pipeline.
 *
 * Run from repository root:
 *   node railway-server/core/__tests__/gen-expected.mjs
 *
 * Overwrites each fixture file in-place. Delete this script after use, or
 * re-run it if the pipeline logic changes and the goldens need refreshing.
 */

import { readFileSync, writeFileSync } from 'fs'
import { join, dirname }              from 'path'
import { fileURLToPath }              from 'url'

import { normalize }   from '../normalize.js'
import { reconcile }   from '../reconcile.js'
import { check }       from '../financialIntegrity.js'
import { deriveRatios } from '../deriveMetrics.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(__dirname, 'fixtures')

for (const name of ['xbrl', 'scanned', 'hybrid']) {
  const path    = join(FIXTURES_DIR, `${name}.json`)
  const fixture = JSON.parse(readFileSync(path, 'utf8'))

  const normalized   = normalize({ lineItems: fixture.lineItems })
  const analysis     = reconcile(normalized)
  const warnings     = check(analysis)
  const ratiosByYear = deriveRatios(analysis)

  fixture.expected = { warnings, ratiosByYear }

  writeFileSync(path, JSON.stringify(fixture, null, 2) + '\n', 'utf8')
  console.log(`[${name}] updated — ${warnings.length} warning(s)`)

  for (const [yr, ratios] of Object.entries(ratiosByYear)) {
    const keys = ['Gross Margin %', 'EBITDA Margin %', 'Net Profit Margin %',
                  'Current Ratio', 'Debt to Equity', 'Revenue Growth %',
                  'Altman Z-Score', 'Altman Zone']
    console.log(`  ${yr}:`)
    for (const k of keys) {
      if (k in ratios) console.log(`    ${k}: ${ratios[k]}`)
    }
  }
  console.log()
}

console.log('Done. Review figures above, then commit.')
