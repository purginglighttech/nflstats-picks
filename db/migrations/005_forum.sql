-- 005_forum.sql
-- Member forum: categories, topics, replies, and the moderation report queue.
-- A hidden member or deleted account is represented consistently (author FKs
-- are SET NULL, display falls back to a tombstone name) without corrupting
-- thread order. Moderation actions never erase their audit trail.

CREATE TABLE forum_categories (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        text NOT NULL UNIQUE,
    name        text NOT NULL,
    description text,
    position    integer NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE forum_topics (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id uuid NOT NULL REFERENCES forum_categories (id) ON DELETE CASCADE,
    author_id   uuid REFERENCES users (id) ON DELETE SET NULL,
    title       text NOT NULL,
    status      text NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'locked', 'hidden')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    last_reply_at timestamptz
);
CREATE INDEX forum_topics_category_idx
    ON forum_topics (category_id, updated_at DESC);

CREATE TABLE forum_replies (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id     uuid NOT NULL REFERENCES forum_topics (id) ON DELETE CASCADE,
    author_id    uuid REFERENCES users (id) ON DELETE SET NULL,
    body         text NOT NULL,
    status       text NOT NULL DEFAULT 'visible'
        CHECK (status IN ('visible', 'hidden')),
    -- Operator-visible edit history; public deletion uses a tombstone body.
    edit_history jsonb NOT NULL DEFAULT '[]',
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX forum_replies_topic_idx
    ON forum_replies (topic_id, created_at);

-- Content reports: moderation queue. Reports reference target type + ID without
-- copying the reported text.
CREATE TABLE content_reports (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    target_type text NOT NULL
        CHECK (target_type IN ('forum_topic', 'forum_reply')),
    target_id   uuid NOT NULL,
    reporter_id uuid REFERENCES users (id) ON DELETE SET NULL,
    reason      text NOT NULL,
    status      text NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'resolved', 'dismissed')),
    resolved_by uuid REFERENCES users (id) ON DELETE SET NULL,
    resolved_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX content_reports_target_idx
    ON content_reports (target_type, target_id);
CREATE INDEX content_reports_status_idx
    ON content_reports (status, created_at DESC);
