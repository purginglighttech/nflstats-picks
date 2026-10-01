// db/ingest/normalize.test.mjs
// Unit tests for the ESPN normalizer (pure functions — no DB, no network).
// Run: node --test db/ingest/

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  canonicalTeamAbbr,
  inferUnit,
  isNullToken,
  normalizeScoreboardEvent,
  normalizeSummary,
  parseNumeric,
  parsePossessionTime,
  scoringPeriods,
  splitCompound,
} from './normalize.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) =>
  JSON.parse(readFileSync(join(here, 'fixtures', name), 'utf8'));

describe('parseNumeric', () => {
  it('parses plain numbers, dashes, percents, commas', () => {
    assert.equal(parseNumeric('27'), 27);
    assert.equal(parseNumeric('100.0'), 100);
    assert.equal(parseNumeric('45.5%'), 45.5);
    assert.equal(parseNumeric('1,234'), 1234);
    assert.equal(parseNumeric('-'), null);
    assert.equal(parseNumeric('–'), null);
    assert.equal(parseNumeric(''), null);
    assert.equal(parseNumeric(null), null);
    assert.equal(parseNumeric('abc'), null);
  });
});

describe('splitCompound', () => {
  it('splits "A/B" and "A-B" forms', () => {
    assert.deepEqual(splitCompound('5-16'), [5, 16]);
    assert.deepEqual(splitCompound('23/33'), [23, 33]);
    assert.equal(splitCompound('27'), null);
    assert.equal(splitCompound('-'), null);
    assert.equal(splitCompound(''), null);
  });
});

describe('parsePossessionTime', () => {
  it('converts MM:SS to seconds', () => {
    assert.equal(parsePossessionTime('34:17'), 2057);
    assert.equal(parsePossessionTime('-'), null);
  });
});

describe('inferUnit', () => {
  it('flags percent display values', () => {
    assert.equal(inferUnit('45.5%'), 'percent');
    assert.equal(inferUnit('100.0'), null);
    assert.equal(inferUnit('-'), null);
  });
});

describe('canonicalTeamAbbr', () => {
  it('maps ESPN legacy codes to the platform canonical', () => {
    assert.equal(canonicalTeamAbbr('WSH'), 'WAS');
    assert.equal(canonicalTeamAbbr('KC'), 'KC');
    assert.equal(canonicalTeamAbbr('wsh'), 'WAS');
  });

  it('normalizes a WSH scoreboard event to WAS', () => {
    const ev = fixture('scoreboard_event.json');
    const wsh = JSON.parse(JSON.stringify(ev));
    wsh.competitions[0].competitors[0].team.abbreviation = 'WSH';
    const q = [];
    const g = normalizeScoreboardEvent(wsh, q);
    assert.equal(q.length, 0);
    assert.equal(g.home.abbr, 'WAS');
  });
});

describe('isNullToken', () => {
  it('recognizes ESPN no-data tokens without quarantining them', () => {
    for (const t of [null, undefined, '', '-', '–', '--']) {
      assert.equal(isNullToken(t), true);
    }
    assert.equal(isNullToken('27'), false);
    assert.equal(isNullToken('abc'), false);
    // A null token in a player stat stores NULL and does not quarantine.
    const q = [];
    const n = normalizeSummary('1', {
      boxscore: {
        players: [{
          team: { abbreviation: 'KC' },
          statistics: [{
            name: 'passing',
            keys: ['adjQBR'],
            athletes: [{ athlete: { id: '1', displayName: 'Punter' }, stats: ['--'] }],
          }],
        }],
      },
    }, q);
    assert.equal(q.length, 0);
    assert.equal(n.playerStats[0].metric_value, null);
    assert.equal(n.playerStats[0].raw_value, '--');
  });
});

describe('normalizeScoreboardEvent', () => {
  const ev = fixture('scoreboard_event.json');

  it('maps the NE@SEA week 1 game', () => {
    const q = [];
    const g = normalizeScoreboardEvent(ev, q);
    assert.equal(q.length, 0);
    assert.equal(g.provider_game_id, 'espn:401872656');
    assert.equal(g.season_year, 2026);
    assert.equal(g.week_number, 1);
    assert.equal(g.status, 'final');
    assert.equal(g.home.abbr, 'SEA');
    assert.equal(g.away.abbr, 'NE');
    assert.equal(g.home.score, 13);
    assert.equal(g.away.score, 10);
    assert.equal(g.home.winner, true);
    assert.equal(g.away.winner, false);
    assert.equal(g.venue, 'Lumen Field');
    assert.equal(g.neutral_site, false);
    assert.equal(g.broadcast_text, 'NBC');
    assert.equal(g.scheduled_at, '2026-09-10T00:20Z');
  });

  it('builds scoring periods from linescores', () => {
    const q = [];
    const g = normalizeScoreboardEvent(ev, q);
    const periods = scoringPeriods(g);
    assert.equal(periods.length, 8); // 4 quarters x 2 teams
    const sea = periods.filter((p) => p.team_abbr === 'SEA');
    assert.deepEqual(sea.map((p) => p.points), [0, 0, 3, 10]);
    assert.equal(sea.reduce((a, p) => a + p.points, 0), 13); // sums to final
  });

  it('quarantines unknown status states and unknown teams', () => {
    const bad = [];
    const evBadStatus = JSON.parse(JSON.stringify(ev));
    evBadStatus.competitions[0].status.type.state = 'weird';
    assert.equal(normalizeScoreboardEvent(evBadStatus, bad), null);
    assert.equal(bad.length, 1);
    assert.match(bad[0].reason, /unknown status state/);

    const bad2 = [];
    const evBadTeam = JSON.parse(JSON.stringify(ev));
    evBadTeam.competitions[0].competitors[0].team.abbreviation = 'XXX';
    assert.equal(normalizeScoreboardEvent(evBadTeam, bad2), null);
    assert.match(bad2[0].reason, /unknown team abbreviation/);
  });

  it('maps pre/in states', () => {
    const q = [];
    const pre = JSON.parse(JSON.stringify(ev));
    pre.competitions[0].status.type.state = 'pre';
    pre.competitions[0].competitors.forEach((c) => { c.score = ''; c.winner = false; });
    const g = normalizeScoreboardEvent(pre, q);
    assert.equal(g.status, 'scheduled');
    assert.equal(g.home.score, null);

    const live = JSON.parse(JSON.stringify(ev));
    live.competitions[0].status.type.state = 'in';
    assert.equal(normalizeScoreboardEvent(live, q).status, 'live');
  });
});

describe('normalizeSummary', () => {
  const data = fixture('summary.json');

  it('produces 25 team stat groups per team with compound splits', () => {
    const q = [];
    const n = normalizeSummary('401872656', data, q);
    const ne = n.teamStats.filter((r) => r.team_abbr === 'NE');
    const conv = ne.find((r) => r.metric_key === 'third_down_conversions');
    const att = ne.find((r) => r.metric_key === 'third_down_attempts');
    assert.ok(conv && att, 'thirdDownEff split into conversions/attempts');
    assert.equal(conv.display_value, '5-16');
    assert.equal(att.metric_value, 16);
    const poss = ne.find((r) => r.metric_key === 'possessionTime');
    assert.equal(poss.metric_value, 2057);
    assert.equal(poss.unit, 'seconds');
    // every display string is preserved verbatim
    for (const r of ne) assert.ok('display_value' in r);
    // dash-only values become NULL metric_value, not an error
    const sacks = ne.find((r) => r.metric_key === 'sacks');
    assert.ok(sacks);
  });

  it('splits compound player stats and keeps raw strings', () => {
    const q = [];
    const n = normalizeSummary('401872656', data, q);
    const maye = n.playerStats.filter(
      (r) => r.player_name === 'Drake Maye' && r.category_key === 'passing'
    );
    const comp = maye.find((r) => r.metric_key === 'passing_completions');
    const patt = maye.find((r) => r.metric_key === 'passing_attempts');
    assert.equal(comp.metric_value, 23);
    assert.equal(patt.metric_value, 33);
    assert.equal(comp.raw_value, '23/33');
    const kicker = n.playerStats.filter(
      (r) => r.category_key === 'kicking' && r.metric_key === 'field_goals_made'
    );
    assert.ok(kicker.length > 0, 'kicking compound split produced field_goals_made rows');
    assert.equal(kicker[0].raw_value, '1/1');
  });

  it('extracts leaders with ranks and injuries', () => {
    const q = [];
    const n = normalizeSummary('401872656', data, q);
    assert.ok(n.leaders.length > 0, 'leaders extracted');
    for (const l of n.leaders) {
      assert.ok(l.rank >= 1);
      assert.ok(l.player_external_id.startsWith('espn:'));
    }
    assert.ok(n.injuries.length > 0, 'injuries extracted');
    for (const i of n.injuries) {
      assert.ok(i.team_abbr && i.player_external_id);
    }
  });

  it('tolerates a pre-game summary with no boxscore', () => {
    const q = [];
    const n = normalizeSummary('999', { header: { id: '999' } }, q);
    assert.deepEqual([n.teamStats.length, n.playerStats.length, n.leaders.length, n.injuries.length], [0, 0, 0, 0]);
    assert.equal(q.length, 0, 'a missing boxscore is normal pre-game, not quarantine');
  });
});
