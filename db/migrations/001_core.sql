-- 001_core.sql
-- Extensions, identity tables (users, profiles, sessions, tokens, settings),
-- and competition pools + memberships.
--
-- AUTH CONTRACTS (sibling C codes against these verbatim — do not rename/retire
-- columns without coordinating):
--   users(id, email citext UNIQUE, password_hash, email_verified_at, created_at, updated_at)
--   profiles(user_id PK -> users, display_name UNIQUE, created_at, updated_at)
--   sessions(id, user_id -> users, token_hash UNIQUE, created_at, expires_at,
--            last_seen_at, revoked_at)
--   email_verification_tokens(id, user_id -> users, token_hash UNIQUE, expires_at,
--            consumed_at, created_at)
--   password_reset_tokens(id, user_id -> users, token_hash UNIQUE, expires_at,
--            consumed_at, created_at)
--   user_settings(user_id PK -> users, accent_source 'team'|'neutral',
--            luminance 'light'|'dark'|'system', timezone, updated_at)

-- Extensions ----------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- Users ---------------------------------------------------------------------
CREATE TABLE users (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email            citext NOT NULL UNIQUE,
    password_hash    text NOT NULL,
    email_verified_at timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Profiles: public identity, unique display name --------------------------------
CREATE TABLE profiles (
    user_id      uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    display_name text NOT NULL UNIQUE,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Sessions: server-side session records; cookie holds the raw token, we store
-- only its hash. -----------------------------------------------------------------
CREATE TABLE sessions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash  text NOT NULL UNIQUE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    revoked_at  timestamptz
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);

-- Email verification tokens ------------------------------------------------------
CREATE TABLE email_verification_tokens (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_verification_tokens_user_id_idx ON email_verification_tokens (user_id);

-- Password reset tokens ------------------------------------------------------------
CREATE TABLE password_reset_tokens (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_tokens_user_id_idx ON password_reset_tokens (user_id);

-- User settings: theme model axes (accent source + luminance) and timezone -----------
CREATE TABLE user_settings (
    user_id       uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    accent_source text NOT NULL DEFAULT 'team'
        CHECK (accent_source IN ('team', 'neutral')),
    luminance     text NOT NULL DEFAULT 'system'
        CHECK (luminance IN ('light', 'dark', 'system')),
    timezone      text NOT NULL DEFAULT 'America/Los_Angeles',
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Competition pools (spec decision #1: one invite-only global pool for beta;
-- membership model supports private pools later) -------------------------------------
CREATE TABLE pools (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name       text NOT NULL,
    slug       text NOT NULL UNIQUE,
    is_global  boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pool_id    uuid NOT NULL REFERENCES pools (id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role       text NOT NULL DEFAULT 'member'
        CHECK (role IN ('member', 'operator', 'moderator')),
    status     text NOT NULL DEFAULT 'active'
        CHECK (status IN ('invited', 'active', 'suspended', 'removed')),
    invited_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (pool_id, user_id)
);
CREATE INDEX memberships_user_id_idx ON memberships (user_id);
