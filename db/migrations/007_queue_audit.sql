-- 007_queue_audit.sql
-- Database-backed worker queue and the append-only audit log.
--
-- Queue contract (db/worker.mjs claims due jobs with SELECT ... FOR UPDATE
-- SKIP LOCKED): handlers key off payload.type; Phase 1 ships only a `noop`
-- handler to prove the seam. Phase 2+ adds real handlers here as tables and
-- in the worker.

CREATE TABLE jobs (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    queue       text NOT NULL DEFAULT 'default',
    payload     jsonb NOT NULL DEFAULT '{}',
    status      text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'done', 'failed')),
    attempts    integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 5,
    run_at      timestamptz NOT NULL DEFAULT now(),
    locked_by   text,
    locked_at   timestamptz,
    last_error  text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
-- Claim path: due, queued jobs oldest-first.
CREATE INDEX jobs_claim_idx
    ON jobs (status, run_at, created_at)
    WHERE status = 'queued';
CREATE INDEX jobs_queue_idx ON jobs (queue, status);

-- Audit log: append-only. Administrative corrections require a reason and
-- produce an immutable event here; application database users must not be
-- able to alter these rows.
CREATE TABLE audit_log (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at timestamptz NOT NULL DEFAULT now(),
    actor_type text NOT NULL
        CHECK (actor_type IN ('user', 'operator', 'system')),
    actor_id   uuid,
    action     text NOT NULL,
    target_type text,
    target_id  text,
    details    jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_target_idx ON audit_log (target_type, target_id);
CREATE INDEX audit_log_occurred_idx ON audit_log (occurred_at DESC);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_type, actor_id);

CREATE TRIGGER audit_log_append_only_trg
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION reject_append_only_write();
