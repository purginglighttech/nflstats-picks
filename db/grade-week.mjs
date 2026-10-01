// db/grade-week.mjs
// One-shot grading operator: deadline sweep + grading + standings projection
// for one season/week. Mirrors db/ingest-week.mjs.
//
// Usage:
//   DATABASE_URL=... node db/grade-week.mjs --season 2026 --week 4
//
// Env: DATABASE_URL (required).
//
// Idempotent: re-running recomputes the same outcomes (corrections regrade
// deterministically). Grading begins with the first week the operator grades;
// earlier weeks are pre-competition history and accrue no outcomes.

import { gradeWeek } from './grade/grade.mjs';

function usage() {
  console.error('usage: node db/grade-week.mjs --season <year> --week <n>');
  process.exit(2);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--season') out.season = Number(argv[++i]);
    else if (a === '--week') out.week = Number(argv[++i]);
    else usage();
  }
  if (!Number.isInteger(out.season) || !Number.isInteger(out.week) || out.week < 1) {
    usage();
  }
  return out;
}

try {
  const { season, week } = parseArgs(process.argv.slice(2));
  const r = await gradeWeek({ season, week });
  console.log(
    `grade-week: season ${r.season} week ${r.week} OK — ` +
      `${r.games} games, ${r.swept} swept, ${r.committed} picks committed, ` +
      `${r.misses} misses, ${r.graded} graded`
  );
} catch (err) {
  console.error(`grade-week: FAILED: ${err.message}`);
  process.exit(1);
}
