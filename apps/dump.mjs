import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r = await c.query(
  `SELECT w.number AS week, ta.abbreviation AS away, th.abbreviation AS home
   FROM games g
   JOIN weeks w ON w.id = g.week_id
   JOIN seasons s ON s.id = g.season_id
   JOIN teams ta ON ta.id = g.away_team_id
   JOIN teams th ON th.id = g.home_team_id
   WHERE s.year = 2026 AND w.number IN (1,2,3)
   ORDER BY w.number, g.scheduled_at`
);
console.log('participant,season,week,away_team,home_team,selected_team');
for (const row of r.rows) console.log(`${process.argv[2]},2026,${row.week},${row.away},${row.home},`);
await c.end();
