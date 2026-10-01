// db/pool-members.mjs
// Beta invite management for the one invite-only global pool (spec decision #1).
// Registration does NOT auto-join the pool; the operator adds members here.
// Only active global-pool members may save picks, appear in reveal
// denominators, or accrue competition outcomes.
//
// Usage:
//   DATABASE_URL=... node db/pool-members.mjs list
//   DATABASE_URL=... node db/pool-members.mjs add <email> [--role member|operator|moderator]
//   DATABASE_URL=... node db/pool-members.mjs remove <email>
//
// Env: DATABASE_URL (required).

import pg from 'pg';

function fail(msg) {
  console.error(`pool-members: ${msg}`);
  process.exit(2);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) fail('DATABASE_URL is not set');

  const [cmd, email, ...rest] = process.argv.slice(2);
  if (!cmd || !['list', 'add', 'remove'].includes(cmd)) {
    fail('usage: pool-members.mjs <list|add|remove> [email] [--role member|operator|moderator]');
  }
  if (cmd !== 'list' && !email) fail(`${cmd} requires an email address`);

  const roleFlag = rest.find((a) => a.startsWith('--role='));
  const role = roleFlag ? roleFlag.slice('--role='.length) : 'member';
  if (!['member', 'operator', 'moderator'].includes(role)) {
    fail(`invalid role: ${role}`);
  }

  const pool = new pg.Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    const { rows: poolRows } = await client.query(
      `SELECT id FROM pools WHERE is_global LIMIT 1`
    );
    if (poolRows.length === 0) fail('no global pool — run migrations first');
    const poolId = poolRows[0].id;

    if (cmd === 'list') {
      const { rows } = await client.query(
        `SELECT u.email, u.display_name, m.role, m.status, m.created_at
         FROM memberships m
         JOIN users u ON u.id = m.user_id
         WHERE m.pool_id = $1
         ORDER BY m.created_at`,
        [poolId]
      );
      if (rows.length === 0) {
        console.log('pool-members: global pool has no members');
      } else {
        for (const r of rows) {
          console.log(
            `${r.email} — ${r.display_name ?? '(no display name)'} — ${r.role} — ${r.status}`
          );
        }
      }
      return;
    }

    const { rows: userRows } = await client.query(
      `SELECT id, email FROM users WHERE lower(email) = lower($1)`,
      [email]
    );
    if (userRows.length === 0) fail(`no user with email ${email}`);
    const userId = userRows[0].id;

    if (cmd === 'add') {
      await client.query(
        `INSERT INTO memberships (pool_id, user_id, role, status)
         VALUES ($1, $2, $3, 'active')
         ON CONFLICT (pool_id, user_id) DO UPDATE SET
           role = EXCLUDED.role,
           status = 'active'`,
        [poolId, userId, role]
      );
      console.log(`pool-members: ${email} added to the global pool as ${role}`);
    } else {
      const res = await client.query(
        `UPDATE memberships SET status = 'removed'
         WHERE pool_id = $1 AND user_id = $2 AND status <> 'removed'`,
        [poolId, userId]
      );
      console.log(
        res.rowCount > 0
          ? `pool-members: ${email} removed from the global pool`
          : `pool-members: ${email} was not an active member`
      );
    }
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
