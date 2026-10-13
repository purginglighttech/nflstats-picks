// db/publish-report.mjs
// Report publish gate (operator CLI).
//
// The read API exposes only status='published' editions. This script is
// the gate that moves an edition there, enforcing the site's rule:
//
//   - Factual editions publish directly (they were structurally
//     validated at import time).
//   - Editions whose content_class is prediction, opinion, or mixed
//     carry public_approval_required and must be APPROVED first.
//     Approval is an explicit, separate act: --approve stamps the
//     edition 'approved'; a later run without --approve publishes it.
//
// Running this on the production box (fly ssh console) as the operator
// is the approval — the operator is the gate, the script is its record.
//
// Usage:
//   DATABASE_URL=... node db/publish-report.mjs --list
//   DATABASE_URL=... node db/publish-report.mjs --show <uuid>
//   DATABASE_URL=... node db/publish-report.mjs --id <uuid> [--approve] [--dry-run]
//
// --show prints the edition's full stored content (every entry and
// citation) for audit before approval: the reviewer reads exactly what
// is in the database, not the source file it was imported from. It is
// read-only and works at any status, so published editions can be
// audited after the fact too.

import pg from 'pg';

function databaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('publish-report: DATABASE_URL is not set');
  return url;
}

function usage() {
  console.error(
    'usage: node db/publish-report.mjs (--list | --show <uuid> | --id <uuid> [--approve]) [--dry-run]'
  );
  process.exit(2);
}

function parseArgs(argv) {
  const out = { dryRun: false, approve: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--id') out.id = argv[++i];
    else if (a === '--show') out.show = argv[++i];
    else if (a === '--approve') out.approve = true;
    else if (a === '--list') out.list = true;
    else if (a === '--dry-run') out.dryRun = true;
    else usage();
  }
  const modes = [out.list, out.id != null, out.show != null].filter(Boolean).length;
  if (modes !== 1) usage();
  return out;
}

function fail(msg) {
  throw new Error(`publish-report: ${msg}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = new pg.Client(databaseUrl());
  await client.connect();
  try {
    if (args.list) {
      const r = await client.query(
        `SELECT e.id, e.report_type, e.title, e.status,
                e.public_approval_required, s.year AS season, w.number AS week
           FROM report_editions e
           LEFT JOIN seasons s ON s.id = e.season_id
           LEFT JOIN weeks w ON w.id = e.week_id
          WHERE e.status <> 'published'
          ORDER BY e.generated_at DESC`
      );
      if (r.rows.length === 0) {
        console.log('publish-report: no unpublished editions');
        return;
      }
      for (const row of r.rows) {
        console.log(
          `${row.id}  ${row.status.padEnd(16)} ${row.report_type.padEnd(18)} ` +
            `season ${row.season ?? '-'} week ${row.week ?? '-'}  ` +
            `${row.public_approval_required ? '[approval required] ' : ''}"${row.title}"`
        );
      }
      return;
    }

    if (args.show) {
      const er = await client.query(
        `SELECT e.id, e.report_type, e.content_class, e.title, e.summary,
                e.status, e.public_approval_required, e.revision,
                e.reporting_period, e.methodology_version, e.dataset_revision,
                s.year AS season, w.number AS week
           FROM report_editions e
           LEFT JOIN seasons s ON s.id = e.season_id
           LEFT JOIN weeks w ON w.id = e.week_id
          WHERE e.id = $1`,
        [args.show]
      );
      if (er.rows.length === 0) fail(`no edition with id ${args.show}`);
      const ed = er.rows[0];
      console.log(`# ${ed.title}`);
      console.log(
        `${ed.report_type} · ${ed.content_class} · status '${ed.status}' · ` +
          `approval ${ed.public_approval_required ? 'REQUIRED' : 'not required'} · revision ${ed.revision}`
      );
      const scope = [];
      if (ed.season != null) scope.push(`Season ${ed.season}`);
      if (ed.week != null) scope.push(`Week ${ed.week}`);
      if (ed.reporting_period) scope.push(ed.reporting_period);
      if (scope.length > 0) console.log(scope.join(' · '));
      const prov = [];
      if (ed.methodology_version) prov.push(`Methodology ${ed.methodology_version}`);
      if (ed.dataset_revision) prov.push(`Dataset ${ed.dataset_revision}`);
      if (prov.length > 0) console.log(prov.join(' · '));
      if (ed.summary) console.log(`\nSummary: ${ed.summary}`);

      const entries = await client.query(
        `SELECT entry_key, block_type, heading, body FROM report_entries
          WHERE report_edition_id = $1 ORDER BY position ASC`,
        [ed.id]
      );
      entries.rows.forEach((e, i) => {
        console.log(
          `\n--- [${i + 1}] ${e.block_type} · ${e.entry_key}` +
            (e.heading ? ` — "${e.heading}"` : '')
        );
        console.log(e.body);
      });

      const cites = await client.query(
        `SELECT c.claim_key, c.url, c.publisher, c.corroboration_status,
                c.limitation_note, en.entry_key AS entry_key
           FROM source_citations c
           LEFT JOIN report_entries en ON en.id = c.report_entry_id
          WHERE c.report_edition_id = $1
          ORDER BY c.created_at ASC`,
        [ed.id]
      );
      if (cites.rows.length > 0) {
        console.log('\nCitations:');
        for (const c of cites.rows) {
          const where = [c.entry_key, c.claim_key].filter(Boolean).join(' · ');
          console.log(`  -${where ? ` [${where}]` : ''} ${c.publisher ?? ''} ${c.url}`);
          if (c.corroboration_status)
            console.log(`    Corroboration: ${c.corroboration_status}`);
          if (c.limitation_note) console.log(`    Note: ${c.limitation_note}`);
        }
      }
      return;
    }

    const r = await client.query(
      `SELECT id, report_type, title, status, public_approval_required
         FROM report_editions WHERE id = $1`,
      [args.id]
    );
    if (r.rows.length === 0) fail(`no edition with id ${args.id}`);
    const ed = r.rows[0];
    console.log(
      `publish-report: "${ed.title}" (${ed.report_type}) — status '${ed.status}', ` +
        `approval ${ed.public_approval_required ? 'REQUIRED' : 'not required'}`
    );

    if (args.approve) {
      if (ed.status === 'approved') {
        console.log('publish-report: already approved, nothing to do');
        return;
      }
      if (ed.status === 'published') {
        console.log('publish-report: already published, nothing to do');
        return;
      }
      if (ed.status === 'withdrawn') fail('edition is withdrawn and cannot be approved');
      if (args.dryRun) {
        console.log('publish-report: --dry-run, would set status to approved');
        return;
      }
      await client.query(
        `UPDATE report_editions SET status = 'approved', updated_at = now() WHERE id = $1`,
        [ed.id]
      );
      console.log('publish-report: approved. Run again without --approve to publish.');
      return;
    }

    // Publish path.
    if (ed.status === 'published') {
      console.log('publish-report: already published, nothing to do');
      return;
    }
    if (ed.status === 'withdrawn') fail('edition is withdrawn and cannot be published');
    if (ed.public_approval_required && ed.status !== 'approved') {
      fail(
        `this edition requires approval before publishing — ` +
          `run: node db/publish-report.mjs --id ${ed.id} --approve`
      );
    }
    if (args.dryRun) {
      console.log('publish-report: --dry-run, would set status to published');
      return;
    }
    await client.query(
      `UPDATE report_editions SET status = 'published', updated_at = now() WHERE id = $1`,
      [ed.id]
    );
    console.log('publish-report: published — the edition is now live on the site');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
