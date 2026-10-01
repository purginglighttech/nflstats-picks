-- 003_editorial.sql
-- Editorial entities: news, report editions with ordered entries, ranking
-- entries, source citations, weekly features + game analyses, team assessments
-- with append-only revisions, statement assessments, and the review gate.

-- News items: attributed content with canonical-URL deduplication ----------------------
CREATE TABLE news_items (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_url text NOT NULL UNIQUE,
    title        text NOT NULL,
    excerpt      text,
    source_name  text,
    published_at timestamptz,
    fetched_at   timestamptz NOT NULL DEFAULT now(),
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX news_items_published_idx ON news_items (published_at DESC);

-- Team tagging for news (News tab = team-tagged news and personnel reports).
CREATE TABLE news_item_teams (
    news_item_id uuid NOT NULL REFERENCES news_items (id) ON DELETE CASCADE,
    team_id      uuid NOT NULL REFERENCES teams (id),
    PRIMARY KEY (news_item_id, team_id)
);
CREATE INDEX news_item_teams_team_idx ON news_item_teams (team_id);

-- Report editions: structured published reports (final-game reports, briefings,
-- post-week reviews, rankings, Wednesday previews, injury sweeps, inactives,
-- pregame checks). ----------------------------------------------------------------------
CREATE TABLE report_editions (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_type             text NOT NULL
        CHECK (report_type IN (
            'teams', 'quarterbacks', 'offense', 'defense', 'special_teams',
            'outlet_roundup', 'game_final', 'news_briefing', 'personnel',
            'post_week', 'wednesday_preview', 'injury_sweep', 'inactives',
            'pregame_check')),
    content_class           text NOT NULL
        CHECK (content_class IN ('factual', 'prediction', 'opinion', 'mixed')),
    public_approval_required boolean NOT NULL DEFAULT false,
    season_id               uuid REFERENCES seasons (id),
    week_id                 uuid REFERENCES weeks (id),
    game_id                 uuid REFERENCES games (id),
    title                   text NOT NULL,
    summary                 text,
    generated_at            timestamptz NOT NULL DEFAULT now(),
    reporting_period        text,
    status                  text NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'validated', 'review_ready', 'changes_requested',
                          'approved', 'published', 'withdrawn')),
    revision                integer NOT NULL DEFAULT 1,
    pdf_asset_ref           text,
    methodology_version     text,
    dataset_revision        text,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);
-- Archives and versioning: one edition per report type/season/week/revision.
CREATE UNIQUE INDEX report_editions_archive_unique
    ON report_editions (report_type, season_id, week_id, revision);
CREATE INDEX report_editions_status_idx ON report_editions (status);

-- Report entries: ordered blocks separating empirical evidence from
-- in-house interpretation; every material claim has a stable claim key. ------------
CREATE TABLE report_entries (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_edition_id uuid NOT NULL REFERENCES report_editions (id) ON DELETE CASCADE,
    entry_key        text NOT NULL,
    position         integer NOT NULL,
    block_type       text NOT NULL
        CHECK (block_type IN ('evidence', 'interpretation', 'summary')),
    heading          text,
    body             text NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (report_edition_id, entry_key)
);
CREATE INDEX report_entries_order_idx
    ON report_entries (report_edition_id, position);

-- Ranking entries: one ranked subject. The five in-house Tuesday editions each
-- require exactly 32 entries; the outlet roundup stores one complete 1-32 list
-- per outlet plus the separate in-house list (publisher distinguishes them). ---
CREATE TABLE ranking_entries (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_edition_id uuid NOT NULL REFERENCES report_editions (id) ON DELETE CASCADE,
    publisher         text NOT NULL DEFAULT 'in-house',
    subject_type      text NOT NULL DEFAULT 'team'
        CHECK (subject_type IN ('team', 'player')),
    subject_id        uuid,
    subject_team_id   uuid REFERENCES teams (id),
    rank              integer NOT NULL CHECK (rank >= 1),
    previous_rank     integer,
    movement          integer,
    record_text       text,
    metric_basis      text,
    metric_value      numeric,
    writeup           text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (report_edition_id, publisher, subject_id)
);
CREATE INDEX ranking_entries_rank_idx
    ON ranking_entries (report_edition_id, publisher, rank);

-- Source citations: attribution + corroboration for material claims --------------------
CREATE TABLE source_citations (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_edition_id uuid NOT NULL REFERENCES report_editions (id) ON DELETE CASCADE,
    report_entry_id   uuid REFERENCES report_entries (id) ON DELETE CASCADE,
    claim_key         text,
    url               text NOT NULL,
    publisher         text,
    retrieved_at      timestamptz NOT NULL DEFAULT now(),
    source_family     text,
    independently_corroborates boolean NOT NULL DEFAULT false,
    corroboration_status text
        CHECK (corroboration_status IN
            ('confirmed_multi_source', 'single_source_exception', 'not_applicable')),
    limitation_note   text,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX source_citations_attribution_idx
    ON source_citations (report_edition_id, report_entry_id);

-- Weekly features: Wednesday editions, one per season week ----------------------------
CREATE TABLE weekly_features (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id       uuid NOT NULL REFERENCES seasons (id) ON DELETE CASCADE,
    week_id         uuid NOT NULL REFERENCES weeks (id) ON DELETE CASCADE,
    publish_at      timestamptz NOT NULL,
    title           text NOT NULL,
    summary         text,
    status          text NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'review_ready', 'changes_requested',
                          'approved', 'published', 'withdrawn')),
    slate_complete  boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (season_id, week_id)
);

-- Game analyses: one versioned record per game per weekly feature with explicit
-- phase (pre_wednesday / preview / post_final). The approved preview revision
-- is immutable and stays addressable after the final. -------------------------------
CREATE TABLE game_analyses (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    weekly_feature_id  uuid NOT NULL REFERENCES weekly_features (id) ON DELETE CASCADE,
    game_id            uuid NOT NULL REFERENCES games (id) ON DELETE CASCADE,
    phase              text NOT NULL DEFAULT 'pre_wednesday'
        CHECK (phase IN ('pre_wednesday', 'preview', 'post_final')),
    probabilities      jsonb,
    evidence           jsonb,
    scorecard          jsonb,
    baseline           jsonb,
    adjustments        jsonb,
    uncertainty        jsonb,
    author             text,
    citations          jsonb,
    approved_revision_id uuid,
    published_at       timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (weekly_feature_id, game_id)
);
CREATE INDEX game_analyses_game_idx ON game_analyses (game_id);

-- Team assessments: current public read per team per assessment type --------------------
CREATE TABLE team_assessments (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id            uuid NOT NULL REFERENCES teams (id),
    assessment_type    text NOT NULL
        CHECK (assessment_type IN
            ('league_position', 'development_philosophy', 'injury', 'sustainability')),
    effective_start    date NOT NULL,
    effective_end      date,
    status             text NOT NULL DEFAULT 'not_yet_assessed'
        CHECK (status IN ('not_yet_assessed', 'draft', 'published')),
    current_revision_id uuid,
    evidence_refs      jsonb,
    author             text,
    reviewer           text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (team_id, assessment_type, effective_start)
);

-- Team assessment revisions: append-only public analysis history --------------------------
CREATE TABLE team_assessment_revisions (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_assessment_id uuid NOT NULL REFERENCES team_assessments (id) ON DELETE CASCADE,
    revision_number    integer NOT NULL,
    prior_revision_id  uuid REFERENCES team_assessment_revisions (id),
    public_text        text,
    structured_state   jsonb,
    evidence_snapshot  jsonb,
    change_reason      text,
    is_correction      boolean NOT NULL DEFAULT false,
    created_at         timestamptz NOT NULL DEFAULT now(),
    published_at       timestamptz,
    UNIQUE (team_assessment_id, revision_number)
);
CREATE INDEX team_assessment_revisions_assessment_idx
    ON team_assessment_revisions (team_assessment_id, revision_number);

CREATE TRIGGER team_assessment_revisions_append_only_trg
    BEFORE UPDATE OR DELETE ON team_assessment_revisions
    FOR EACH ROW EXECUTE FUNCTION reject_append_only_write();

ALTER TABLE team_assessments
    ADD CONSTRAINT team_assessments_current_revision_fk
    FOREIGN KEY (current_revision_id) REFERENCES team_assessment_revisions (id);

-- Team statement assessments: one per cited communication, newest first ---------------
CREATE TABLE team_statement_assessments (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id               uuid NOT NULL REFERENCES teams (id),
    communication_type    text NOT NULL
        CHECK (communication_type IN ('press_conference', 'interview', 'staff_statement')),
    communication_at      timestamptz NOT NULL,
    speaker               text,
    outlet                text,
    source_url            text NOT NULL,
    accountability_analysis text,
    publication_status    text NOT NULL DEFAULT 'draft'
        CHECK (publication_status IN ('draft', 'published')),
    author                text,
    reviewer              text,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    UNIQUE (team_id, source_url)
);
CREATE INDEX team_statement_assessments_newest_idx
    ON team_statement_assessments (team_id, communication_at DESC, id);

-- Review requests: empirical-fidelity + editorial-quality gate for public
-- revisions classified prediction / opinion / mixed ---------------------------------------
CREATE TABLE review_requests (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    target_type      text NOT NULL
        CHECK (target_type IN ('report_edition', 'team_assessment',
                               'team_statement_assessment', 'game_analysis')),
    target_id        uuid NOT NULL,
    revision_id      uuid,
    reviewer_user_id uuid REFERENCES users (id),
    requested_at     timestamptz NOT NULL DEFAULT now(),
    decision         text NOT NULL DEFAULT 'pending'
        CHECK (decision IN ('pending', 'approved', 'changes_requested')),
    issue_categories text[] NOT NULL DEFAULT '{}',
    decision_note    text,
    decided_at       timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX review_requests_target_idx
    ON review_requests (target_type, target_id);

-- Review notifications: delivery records for review events (channel, state,
-- provider reference) without storing message-body secrets ----------------------------
CREATE TABLE review_notifications (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    review_request_id  uuid NOT NULL REFERENCES review_requests (id) ON DELETE CASCADE,
    channel            text NOT NULL CHECK (channel IN ('email', 'in_app')),
    delivery_state     text NOT NULL DEFAULT 'queued'
        CHECK (delivery_state IN ('queued', 'sent', 'failed', 'delivered')),
    sent_at            timestamptz,
    provider_reference text,
    created_at         timestamptz NOT NULL DEFAULT now()
);
