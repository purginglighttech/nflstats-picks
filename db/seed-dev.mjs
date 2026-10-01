// db/seed-dev.mjs
// ============================================================================
// DEVELOPMENT FIXTURES — never run against staging/production.
// ============================================================================
// Inserts clearly-labeled local-development data only:
//   - the 32 NFL teams (idempotent by abbreviation)
//   - one dev season (2026) + week 1 (NOT marked current)
//   - the invite-only global pool + a dev membership
//   - one dev user: dev@example.com / password `dev-password-change-me`
//     (email pre-verified), with a profile and default settings
//
// The dev password is hashed with argon2id, the same algorithm as the auth
// stack (apps/web/src/lib/auth), so the seeded user can sign in directly.
//
// Usage:  NODE_ENV=development node db/seed-dev.mjs
// Env:    DATABASE_URL (required)
// Refuses to run when NODE_ENV=production. Never auto-runs from migrations.
// Only node built-ins + the `pg` package.
// ============================================================================

import argon2 from 'argon2';
import pg from 'pg';

const { Client } = pg;

if (process.env.NODE_ENV === 'production') {
  console.error('seed-dev: REFUSING to run with NODE_ENV=production. This script is development fixtures only.');
  process.exit(1);
}

const TEAMS = [
  // [abbreviation, name, city, conference, division, accent]
  ['ARI', 'Cardinals',  'Arizona',       'NFC', 'West',  '#97233F'],
  ['ATL', 'Falcons',    'Atlanta',       'NFC', 'South', '#A7194B'],
  ['BAL', 'Ravens',     'Baltimore',     'AFC', 'North', '#241773'],
  ['BUF', 'Bills',      'Buffalo',       'AFC', 'East',  '#00338D'],
  ['CAR', 'Panthers',   'Carolina',      'NFC', 'South', '#0085CA'],
  ['CHI', 'Bears',      'Chicago',       'NFC', 'North', '#C83803'],
  ['CIN', 'Bengals',    'Cincinnati',    'AFC', 'North', '#FB4F14'],
  ['CLE', 'Browns',     'Cleveland',     'AFC', 'North', '#311D00'],
  ['DAL', 'Cowboys',    'Dallas',        'NFC', 'East',  '#003594'],
  ['DEN', 'Broncos',    'Denver',        'AFC', 'West',  '#FB4F14'],
  ['DET', 'Lions',      'Detroit',       'NFC', 'North', '#0076B6'],
  ['GB',  'Packers',    'Green Bay',     'NFC', 'North', '#203731'],
  ['HOU', 'Texans',     'Houston',       'AFC', 'South', '#03202F'],
  ['IND', 'Colts',      'Indianapolis',  'AFC', 'South', '#002C5F'],
  ['JAX', 'Jaguars',    'Jacksonville',  'AFC', 'South', '#D7A22B'],
  ['KC',  'Chiefs',     'Kansas City',   'AFC', 'West',  '#E31837'],
  ['LAC', 'Chargers',   'Los Angeles',   'AFC', 'West',  '#0080C6'],
  ['LAR', 'Rams',       'Los Angeles',   'NFC', 'West',  '#003594'],
  ['LV',  'Raiders',    'Las Vegas',     'AFC', 'West',  '#A5ACAF'],
  ['MIA', 'Dolphins',   'Miami',         'AFC', 'East',  '#008E97'],
  ['MIN', 'Vikings',    'Minnesota',     'NFC', 'North', '#4F2683'],
  ['NE',  'Patriots',   'New England',   'AFC', 'East',  '#002244'],
  ['NO',  'Saints',     'New Orleans',   'NFC', 'South', '#D3BC8D'],
  ['NYG', 'Giants',     'New York',      'NFC', 'East',  '#0B2265'],
  ['NYJ', 'Jets',       'New York',      'AFC', 'East',  '#125740'],
  ['PHI', 'Eagles',     'Philadelphia',  'NFC', 'East',  '#004C54'],
  ['PIT', 'Steelers',   'Pittsburgh',    'AFC', 'North', '#FFB612'],
  ['SEA', 'Seahawks',   'Seattle',       'NFC', 'West',  '#69BE28'],
  ['SF',  '49ers',      'San Francisco', 'NFC', 'West',  '#AA0000'],
  ['TB',  'Buccaneers', 'Tampa Bay',     'NFC', 'South', '#D50A0A'],
  ['TEN', 'Titans',     'Tennessee',     'AFC', 'South', '#4B92DB'],
  ['WAS', 'Commanders', 'Washington',    'NFC', 'East',  '#5A1414'],
];

const DEV_EMAIL = 'dev@example.com';
const DEV_DISPLAY_NAME = 'devuser';
const DEV_PASSWORD = 'dev-password-change-me';

async function devPasswordHash() {
  return argon2.hash(DEV_PASSWORD, { type: argon2.argon2id });
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('seed-dev: DATABASE_URL is not set');
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query('BEGIN');

    // 32 teams, idempotent by abbreviation ---------------------------------
    for (const [abbr, name, city, conf, div, accent] of TEAMS) {
      await client.query(
        `INSERT INTO teams (abbreviation, name, city, conference, division,
                            accent_light, accent_dark)
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         ON CONFLICT (abbreviation) DO UPDATE SET
           name = EXCLUDED.name,
           city = EXCLUDED.city,
           conference = EXCLUDED.conference,
           division = EXCLUDED.division`,
        [abbr, name, city, conf, div, accent]
      );
    }
    console.log(`seed-dev: ${TEAMS.length} teams upserted`);

    // Dev season 2026 -------------------------------------------------------
    const { rows: seasonRows } = await client.query(
      `INSERT INTO seasons (league, year, label)
       VALUES ('NFL', 2026, '2026 season')
       ON CONFLICT (league, year) DO UPDATE SET label = EXCLUDED.label
       RETURNING id`
    );
    // ON CONFLICT ... DO UPDATE returns the row either way.
    const seasonId = seasonRows[0].id;

    // Week 1 — deliberately NOT the current week (dev fixture, no live state).
    await client.query(
      `INSERT INTO weeks (season_id, number, label, is_current)
       VALUES ($1, 1, 'Week 1', false)
       ON CONFLICT (season_id, number) DO NOTHING`,
      [seasonId]
    );
    console.log('seed-dev: season 2026 + week 1 ensured (week 1 is not current)');

    // Invite-only global pool (spec decision #1) ----------------------------
    const { rows: poolRows } = await client.query(
      `INSERT INTO pools (name, slug, is_global)
       VALUES ('Global Pick''em', 'global', true)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`
    );
    const poolId = poolRows[0].id;

    // Dev user ---------------------------------------------------------------
    const devHash = await devPasswordHash();
    const { rows: userRows } = await client.query(
      `INSERT INTO users (email, password_hash, email_verified_at)
       VALUES ($1, $2, now())
       ON CONFLICT (email) DO UPDATE SET email_verified_at = COALESCE(users.email_verified_at, now())
       RETURNING id`,
      [DEV_EMAIL, devHash]
    );
    const userId = userRows[0].id;

    await client.query(
      `INSERT INTO profiles (user_id, display_name)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, DEV_DISPLAY_NAME]
    );

    await client.query(
      `INSERT INTO user_settings (user_id) VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );

    await client.query(
      `INSERT INTO memberships (pool_id, user_id, role, status)
       VALUES ($1, $2, 'operator', 'active')
       ON CONFLICT (pool_id, user_id) DO NOTHING`,
      [poolId, userId]
    );

    await client.query('COMMIT');
    console.log(`seed-dev: dev user ${DEV_EMAIL} ensured (operator in global pool)`);
    console.log('seed-dev: done. DEVELOPMENT FIXTURES ONLY — never against staging/production.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('seed-dev: FAILED:', err.message);
  process.exit(1);
});
