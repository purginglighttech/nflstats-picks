-- 009_seed_teams.sql
-- Reference data: the 32 NFL teams.
--
-- The team_follows (favorites) feature resolves abbreviations against the
-- teams table, and production never runs the dev seed — so without this,
-- every favorite fails with "Unknown team". Team identity data is stable
-- reference data, safe to ship as a migration. The import pipeline upserts
-- on abbreviation, so this coexists with Phase 2 ingestion.
--
-- Source of truth for the list: db/seed-dev.mjs (same abbreviations, names,
-- cities, conferences, divisions, accents). Idempotent: reruns are a no-op.

INSERT INTO teams (abbreviation, name, city, conference, division, accent_light, accent_dark)
VALUES
  ('ARI', 'Cardinals',  'Arizona',       'NFC', 'West',  '#97233F', '#97233F'),
  ('ATL', 'Falcons',    'Atlanta',       'NFC', 'South', '#A7194B', '#A7194B'),
  ('BAL', 'Ravens',     'Baltimore',     'AFC', 'North', '#241773', '#241773'),
  ('BUF', 'Bills',      'Buffalo',       'AFC', 'East',  '#00338D', '#00338D'),
  ('CAR', 'Panthers',   'Carolina',      'NFC', 'South', '#0085CA', '#0085CA'),
  ('CHI', 'Bears',      'Chicago',       'NFC', 'North', '#C83803', '#C83803'),
  ('CIN', 'Bengals',    'Cincinnati',    'AFC', 'North', '#FB4F14', '#FB4F14'),
  ('CLE', 'Browns',     'Cleveland',     'AFC', 'North', '#311D00', '#311D00'),
  ('DAL', 'Cowboys',    'Dallas',        'NFC', 'East',  '#003594', '#003594'),
  ('DEN', 'Broncos',    'Denver',        'AFC', 'West',  '#FB4F14', '#FB4F14'),
  ('DET', 'Lions',      'Detroit',       'NFC', 'North', '#0076B6', '#0076B6'),
  ('GB',  'Packers',    'Green Bay',     'NFC', 'North', '#203731', '#203731'),
  ('HOU', 'Texans',     'Houston',       'AFC', 'South', '#03202F', '#03202F'),
  ('IND', 'Colts',      'Indianapolis',  'AFC', 'South', '#002C5F', '#002C5F'),
  ('JAX', 'Jaguars',    'Jacksonville',  'AFC', 'South', '#D7A22B', '#D7A22B'),
  ('KC',  'Chiefs',     'Kansas City',   'AFC', 'West',  '#E31837', '#E31837'),
  ('LAC', 'Chargers',   'Los Angeles',   'AFC', 'West',  '#0080C6', '#0080C6'),
  ('LAR', 'Rams',       'Los Angeles',   'NFC', 'West',  '#003594', '#003594'),
  ('LV',  'Raiders',    'Las Vegas',     'AFC', 'West',  '#A5ACAF', '#A5ACAF'),
  ('MIA', 'Dolphins',   'Miami',         'AFC', 'East',  '#008E97', '#008E97'),
  ('MIN', 'Vikings',    'Minnesota',     'NFC', 'North', '#4F2683', '#4F2683'),
  ('NE',  'Patriots',   'New England',   'AFC', 'East',  '#002244', '#002244'),
  ('NO',  'Saints',     'New Orleans',   'NFC', 'South', '#D3BC8D', '#D3BC8D'),
  ('NYG', 'Giants',     'New York',      'NFC', 'East',  '#0B2265', '#0B2265'),
  ('NYJ', 'Jets',       'New York',      'AFC', 'East',  '#125740', '#125740'),
  ('PHI', 'Eagles',     'Philadelphia',  'NFC', 'East',  '#004C54', '#004C54'),
  ('PIT', 'Steelers',   'Pittsburgh',    'AFC', 'North', '#FFB612', '#FFB612'),
  ('SEA', 'Seahawks',   'Seattle',       'NFC', 'West',  '#69BE28', '#69BE28'),
  ('SF',  '49ers',      'San Francisco', 'NFC', 'West',  '#AA0000', '#AA0000'),
  ('TB',  'Buccaneers', 'Tampa Bay',     'NFC', 'South', '#D50A0A', '#D50A0A'),
  ('TEN', 'Titans',     'Tennessee',     'AFC', 'South', '#4B92DB', '#4B92DB'),
  ('WAS', 'Commanders', 'Washington',    'NFC', 'East',  '#5A1414', '#5A1414')
ON CONFLICT (abbreviation) DO NOTHING;
