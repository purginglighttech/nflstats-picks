// db/import-report.mjs
// Report edition import (operator CLI).
//
// Loads one edition (JSON) into report_editions as a DRAFT, with its
// ordered entries and source citations. The read API only ever exposes
// status='published', so importing can never leak content publicly —
// publishing is a separate, explicit step (db/publish-report.mjs).
//
// Usage:
//   DATABASE_URL=... node db/import-report.mjs --file <edition.json> [--dry-run] [--new-revision]
//
// Edition JSON shape (see db/examples/report-edition.example.json):
//   {
//     "report_type": "post_week",            // migration 003 enum
//     "content_class": "mixed",              // factual|prediction|opinion|mixed
//     "title": "Week 5 Post-Week Review",
//     "summary": "...",                      // optional
//     "season": 2026, "week": 5,             // optional; resolved to ids
//     "game_id": "<uuid>",                   // optional, for game_final
//     "reporting_period": "Week 5",          // optional
//     "methodology_version": "v2",           // optional
//     "dataset_revision": "ds-41",           // optional
//     "pdf_asset_ref": null,                 // optional
//     "entries": [
//       { "entry_key": "lead", "block_type": "evidence",
//         "heading": "The numbers", "body": "markdown..." }
//     ],
//     "citations": [
//       { "claim_key": "c1", "entry_key": "lead",   // entry_key optional
//         "url": "https://...", "publisher": "...",
//         "corroboration_status": "single_source_exception",
//         "independently_corroborates": false,
//         "limitation_note": "..." }
//     ]
//   }
//
// Slot + revision rules (the archive unique key is
// report_type/season/week/revision):
//   - No edition for the slot yet       -> insert revision 1 as draft.
//   - Latest revision is still a draft  -> update it in place (entries
//     and citations are replaced wholesale) so re-importing while an
//     edition is being prepared is safe.
//   - Latest revision has left draft    -> refuse; pass --new-revision
//     to start the next revision as a fresh draft instead. Published
//     history is never rewritten by an import.
// public_approval_required is derived, never taken from the file:
// anything that is not purely factual requires approval before it can
// be published (the site's review-gate rule).
// --dry-run validates and reports the plan without writing.

import { readFileSync } from 'node:fs';
import pg from 'pg';

const REPORT_TYPES = [
  'teams', 'quarterbacks', 'offense', 'defense', 'special_teams',
  'outlet_roundup', 'game_final', 'news_briefing', 'personnel',
  'post_week', 'wednesday_preview', 'injury_sweep', 'inactives',
  'pregame_check',
];
const CONTENT_CLASSES = ['factual', 'prediction', 'opinion', 'mixed'];
const BLOCK_TYPES = ['evidence', 'interpretation', 'summary'];
const CORROBORATION = [
  'confirmed_multi_source', 'single_source_exception', 'not_applicable',
];

function databaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('import-report: DATABASE_URL is not set');
  return url;
}

function usage() {
  console.error(
    'usage: node db/import-report.mjs --file <edition.json> [--dry-run] [--new-revision]'
  );
  process.exit(2);
}

function parseArgs(argv) {
  const out = { dryRun: false, newRevision: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') out.file = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--new-revision') out.newRevision = true;
    else usage();
  }
  if (!out.file) usage();
  return out;
}

function fail(msg) {
  throw new Error(`import-report: ${msg}`);
}

/** Structural validation of the edition file. Returns a list of problems. */
function validate(doc) {
  const problems = [];
  if (!doc || typeof doc !== 'object') return ['file does not contain a JSON object'];
  if (!REPORT_TYPES.includes(doc.report_type))
    problems.push(`report_type must be one of: ${REPORT_TYPES.join(', ')}`);
  if (!CONTENT_CLASSES.includes(doc.content_class))
    problems.push(`content_class must be one of: ${CONTENT_CLASSES.join(', ')}`);
  if (!doc.title || typeof doc.title !== 'string' || doc.title.trim() === '')
    problems.push('title is required');
  if (doc.season != null && (!Number.isInteger(doc.season) || doc.season < 2000))
    problems.push('season must be a year like 2026');
  if (doc.week != null && (!Number.isInteger(doc.week) || doc.week < 1 || doc.week > 22))
    problems.push('week must be an integer 1..22');
  if (doc.week != null && doc.season == null)
    problems.push('week requires season');
  if (!Array.isArray(doc.entries) || doc.entries.length === 0) {
    problems.push('entries must be a non-empty array');
  } else {
    const keys = new Set();
    doc.entries.forEach((e, i) => {
      if (!e.entry_key) problems.push(`entries[${i}]: entry_key is required`);
      else if (keys.has(e.entry_key))
        problems.push(`entries[${i}]: duplicate entry_key "${e.entry_key}"`);
      else keys.add(e.entry_key);
      if (!BLOCK_TYPES.includes(e.block_type))
        problems.push(`entries[${i}]: block_type must be one of: ${BLOCK_TYPES.join(', ')}`);
      if (!e.body || typeof e.body !== 'string' || e.body.trim() === '')
        problems.push(`entries[${i}]: body is required`);
    });
  }
  if (doc.citations != null) {
    if (!Array.isArray(doc.citations)) problems.push('citations must be an array');
    else {
      const entryKeys = new Set((doc.entries ?? []).map((e) => e.entry_key));
      doc.citations.forEach((c, i) => {
        if (!c.url) problems.push(`citations[${i}]: url is required`);
        else {
          try {
            const u = new URL(c.url);
            if (u.protocol !== 'http:' && u.protocol !== 'https:')
              problems.push(`citations[${i}]: url must be http(s)`);
          } catch {
            problems.push(`citations[${i}]: url is not a valid URL`);
          }
        }
        if (c.entry_key != null && !entryKeys.has(c.entry_key))
          problems.push(`citations[${i}]: entry_key "${c.entry_key}" matches no entry`);
        if (c.corroboration_status != null && !CORROBORATION.includes(c.corroboration_status))
          problems.push(
            `citations[${i}]: corroboration_status must be one of: ${CORROBORATION.join(', ')}`
          );
      });
    }
  }
  return problems;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const doc = JSON.parse(readFileSync(args.file, 'utf8'));
  const problems = validate(doc);
  if (problems.length > 0) {
    for (const p of problems) console.error(`  - ${p}`);
    fail(`validation failed with ${problems.length} problem(s)`);
  }
  const approvalRequired = doc.content_class !== 'factual';

  const client = new pg.Client(databaseUrl());
  await client.connect();
  try {
    // Resolve season / week / game references to ids.
    let seasonId = null;
    let weekId = null;
    if (doc.season != null) {
      const s = await client.query('SELECT id FROM seasons WHERE year = $1', [doc.season]);
      if (s.rows.length === 0) fail(`no season ${doc.season} in the database — import games first`);
      seasonId = s.rows[0].id;
      if (doc.week != null) {
        const w = await client.query(
          'SELECT id FROM weeks WHERE season_id = $1 AND number = $2',
          [seasonId, doc.week]
        );
        if (w.rows.length === 0) fail(`no week ${doc.week} in season ${doc.season}`);
        weekId = w.rows[0].id;
      }
    }
    if (doc.game_id != null) {
      const g = await client.query('SELECT id FROM games WHERE id = $1', [doc.game_id]);
      if (g.rows.length === 0) fail(`no game with id ${doc.game_id}`);
    }

    // Slot lookup (null-safe on season/week).
    const slot = await client.query(
      `SELECT id, revision, status FROM report_editions
        WHERE report_type = $1
          AND season_id IS NOT DISTINCT FROM $2
          AND week_id IS NOT DISTINCT FROM $3
        ORDER BY revision DESC`,
      [doc.report_type, seasonId, weekId]
    );
    const latest = slot.rows[0] ?? null;

    let action;
    let revision;
    let editionId = null;
    if (args.newRevision) {
      action = 'insert';
      revision = (latest?.revision ?? 0) + 1;
    } else if (!latest) {
      action = 'insert';
      revision = 1;
    } else if (latest.status === 'draft') {
      action = 'update';
      revision = latest.revision;
      editionId = latest.id;
    } else {
      fail(
        `slot ${doc.report_type}/season ${doc.season ?? '-'}/week ${doc.week ?? '-'} ` +
          `is at revision ${latest.revision} with status '${latest.status}' — ` +
          `refusing to rewrite it; pass --new-revision to start revision ${latest.revision + 1}`
      );
    }

    console.log(
      `import-report: ${action} ${doc.report_type} "${doc.title}" ` +
        `(season ${doc.season ?? '-'}, week ${doc.week ?? '-'}, revision ${revision}) ` +
        `— ${doc.entries.length} entries, ${(doc.citations ?? []).length} citations, ` +
        `approval ${approvalRequired ? 'REQUIRED' : 'not required'}`
    );
    if (args.dryRun) {
      console.log('import-report: --dry-run, nothing written');
      return;
    }

    await client.query('BEGIN');
    try {
      if (action === 'insert') {
        const ins = await client.query(
          `INSERT INTO report_editions
             (report_type, content_class, public_approval_required, season_id,
              week_id, game_id, title, summary, reporting_period, status,
              revision, pdf_asset_ref, methodology_version, dataset_revision)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10,$11,$12,$13)
           RETURNING id`,
          [
            doc.report_type, doc.content_class, approvalRequired, seasonId,
            weekId, doc.game_id ?? null, doc.title, doc.summary ?? null,
            doc.reporting_period ?? null, revision, doc.pdf_asset_ref ?? null,
            doc.methodology_version ?? null, doc.dataset_revision ?? null,
          ]
        );
        editionId = ins.rows[0].id;
      } else {
        await client.query(
          `UPDATE report_editions
              SET content_class = $2, public_approval_required = $3,
                  game_id = $4, title = $5, summary = $6, reporting_period = $7,
                  pdf_asset_ref = $8, methodology_version = $9,
                  dataset_revision = $10, updated_at = now()
            WHERE id = $1`,
          [
            editionId, doc.content_class, approvalRequired, doc.game_id ?? null,
            doc.title, doc.summary ?? null, doc.reporting_period ?? null,
            doc.pdf_asset_ref ?? null, doc.methodology_version ?? null,
            doc.dataset_revision ?? null,
          ]
        );
        await client.query('DELETE FROM report_entries WHERE report_edition_id = $1', [editionId]);
        await client.query('DELETE FROM source_citations WHERE report_edition_id = $1', [editionId]);
      }

      const entryIds = new Map();
      for (let i = 0; i < doc.entries.length; i++) {
        const e = doc.entries[i];
        const r = await client.query(
          `INSERT INTO report_entries
             (report_edition_id, entry_key, position, block_type, heading, body)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [editionId, e.entry_key, i, e.block_type, e.heading ?? null, e.body]
        );
        entryIds.set(e.entry_key, r.rows[0].id);
      }
      for (const c of doc.citations ?? []) {
        await client.query(
          `INSERT INTO source_citations
             (report_edition_id, report_entry_id, claim_key, url, publisher,
              source_family, independently_corroborates, corroboration_status,
              limitation_note)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            editionId,
            c.entry_key != null ? entryIds.get(c.entry_key) : null,
            c.claim_key ?? null, c.url, c.publisher ?? null,
            c.source_family ?? null, c.independently_corroborates ?? false,
            c.corroboration_status ?? null, c.limitation_note ?? null,
          ]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
    console.log(`import-report: draft saved, edition id ${editionId}`);
    console.log(
      approvalRequired
        ? 'import-report: this edition requires approval before publishing (db/publish-report.mjs --approve, then publish)'
        : 'import-report: factual edition — publish with db/publish-report.mjs'
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
