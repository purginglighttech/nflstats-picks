-- 004_notifications.sql
-- Notification preferences (independent opt-ins), per-team mutes, push devices,
-- deduplicated notification events, and idempotent deliveries.

-- Notification preferences: explicit opt-ins keyed by user + event type.
-- Following a team or granting OS permission does NOT enable an alert by itself.
CREATE TABLE notification_preferences (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    event_type text NOT NULL
        CHECK (event_type IN ('team_news_published', 'followed_team_game_started',
                              'followed_team_game_final', 'pick_standings_updated')),
    enabled    boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, event_type)
);

-- Per-team mutes for the team-scoped event types: a user may mute an event type
-- for one followed team without disabling it for the others.
CREATE TABLE notification_team_mutes (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    team_id    uuid NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    event_type text NOT NULL
        CHECK (event_type IN ('team_news_published', 'followed_team_game_started',
                              'followed_team_game_final')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, team_id, event_type)
);

-- Push devices: mobile endpoints. Tokens are sensitive operational data;
-- removed or invalidated after permanent provider rejection, sign-out, or
-- account deletion. Never exposed to other users.
CREATE TABLE push_devices (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    platform        text NOT NULL CHECK (platform IN ('ios', 'android')),
    installation_id text,
    provider_token  text NOT NULL,
    permission_state text NOT NULL DEFAULT 'unknown'
        CHECK (permission_state IN ('unknown', 'granted', 'denied')),
    app_version     text,
    locale          text,
    last_seen_at    timestamptz,
    invalidated_at  timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (platform, provider_token)
);
CREATE INDEX push_devices_user_idx ON push_devices (user_id);

-- Notification events: deduplicated triggers. The uniqueness key means a
-- corrected final (new result revision) is a separate event, labeled as a
-- correction, while duplicate source states never create duplicate delivery.
CREATE TABLE notification_events (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type      text NOT NULL
        CHECK (event_type IN ('team_news_published', 'followed_team_game_started',
                              'followed_team_game_final', 'pick_standings_updated',
                              'review_decision')),
    subject_id      text NOT NULL,
    source_revision text NOT NULL,
    occurred_at     timestamptz NOT NULL DEFAULT now(),
    payload_version integer NOT NULL DEFAULT 1,
    deep_link       text,
    payload         jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (event_type, subject_id, source_revision)
);
CREATE INDEX notification_events_occurred_idx
    ON notification_events (occurred_at DESC);

-- Notification deliveries: event x user x device. Eligibility is evaluated at
-- send time from the event-specific opt-in, active follow, active device
-- permission, and current token.
CREATE TABLE notification_deliveries (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id           uuid NOT NULL REFERENCES notification_events (id) ON DELETE CASCADE,
    user_id            uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    device_id          uuid REFERENCES push_devices (id) ON DELETE SET NULL,
    channel            text NOT NULL
        CHECK (channel IN ('email', 'in_app', 'push')),
    attempt            integer NOT NULL DEFAULT 1,
    state              text NOT NULL DEFAULT 'queued'
        CHECK (state IN ('queued', 'sent', 'failed', 'delivered')),
    provider_reference text,
    deep_link          text,
    sent_at            timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (event_id, user_id, device_id)
);
CREATE INDEX notification_deliveries_user_idx
    ON notification_deliveries (user_id, created_at DESC);
