/**
 * serverIntegration.example.js
 *
 * Shows how to replace the inline calculateRatios / validateAnalysis calls in
 * server.js with the generic pipeline core.  This file is NEVER imported —
 * it exists purely as a reference for the refactor step.
 *
 * BEFORE (server.js ~line 395):
 * ─────────────────────────────
 *   validateAnalysis(analysis)
 *   const ratiosByYear = calculateRatios(analysis)
 *   return res.status(200).json({ success: true, analysis, ratiosByYear, mode })
 *
 * AFTER:
 * ──────
 *   import { run } from './core/pipeline.js'
 *   ...
 *   const { ratiosByYear, warnings } = run(analysis)
 *   if (warnings.length) console.warn('[pipeline]', warnings.join(' | '))
 *   return res.status(200).json({ success: true, analysis, ratiosByYear, mode })
 *
 * The shape of `ratiosByYear` is identical to the current calculateRatios output
 * so no changes are needed in the frontend or the /analyze response contract.
 *
 * Additional benefit — cfmByYear is now available for the CMA generator:
 *
 *   const { ratiosByYear, warnings, cfmByYear } = run(analysis)
 *   const wb = await generateCMAWorkbook(analysis, ratiosByYear, { cfmByYear })
 *
 * Steps to wire in (do NOT perform here — wait for the refactor branch):
 *   1. Add `import { run } from './core/pipeline.js'` at the top of server.js
 *   2. Replace the two calls above with `const { ratiosByYear, warnings } = run(analysis)`
 *   3. Delete the now-unused `calculateRatios` and `validateAnalysis` functions
 *   4. Re-run core.test.js to confirm green
 *   5. Start server, repeat the Lake Chemicals analysis, diff against /baseline/
 */

// Nothing to execute — this file is documentation only.
