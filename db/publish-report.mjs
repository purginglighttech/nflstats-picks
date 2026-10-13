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
//   DATABASE_URL=... node db/publish-report.mjs --id <uuid> [--approve] [--dry-run]

import pg from 'pg';

function databaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('publish-report: DATABASE_URL is not set');
  return url;
}

function usage() {
  console.error(
    'usage: node db/publish-report.mjs (--list | --id <uuid> [--approve]) [--dry-run]'
  );
  process.exit(2);
}

function parseArgs(argv) {
  const out = { dryRun: false, approve: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--id') out.id = argv[++i];
    else if (a === '--approve') out.approve = true;
    else if (a === '--list') out.list = true;
    else if (a === '--dry-run') out.dryRun = true;
    else usage();
  }
  if (!out.list && !out.id) usage();
  if (out.list && out.id) usage();
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
