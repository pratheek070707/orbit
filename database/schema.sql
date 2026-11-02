CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS users (
  user_id BIGSERIAL PRIMARY KEY, login VARCHAR(80) NOT NULL UNIQUE, full_name VARCHAR(160) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin','developer','reviewer','maintainer')),
  status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  avatar_url TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS repositories (
  repo_id BIGSERIAL PRIMARY KEY, owner_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL, full_name VARCHAR(200) NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '',
  primary_language VARCHAR(60) NOT NULL DEFAULT 'Unknown', visibility VARCHAR(12) NOT NULL CHECK (visibility IN ('public','private')),
  is_archived BOOLEAN NOT NULL DEFAULT FALSE, stars_count INTEGER NOT NULL DEFAULT 0 CHECK (stars_count >= 0),
  forks_count INTEGER NOT NULL DEFAULT 0 CHECK (forks_count >= 0), open_issues_count INTEGER NOT NULL DEFAULT 0 CHECK (open_issues_count >= 0),
  topics TEXT[] NOT NULL DEFAULT '{}', readme TEXT NOT NULL DEFAULT '', summary_embedding VECTOR(384),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS repository_members (
  repo_id BIGINT NOT NULL REFERENCES repositories(repo_id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin','maintainer','developer','reviewer')),
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(repo_id,user_id)
);
CREATE TABLE IF NOT EXISTS commits (
  commit_id BIGSERIAL PRIMARY KEY, repo_id BIGINT NOT NULL REFERENCES repositories(repo_id) ON DELETE CASCADE,
  author_id BIGINT NOT NULL REFERENCES users(user_id), commit_hash VARCHAR(64) NOT NULL UNIQUE,
  message TEXT NOT NULL, lines_added INTEGER NOT NULL DEFAULT 0 CHECK (lines_added >= 0),
  lines_deleted INTEGER NOT NULL DEFAULT 0 CHECK (lines_deleted >= 0), committed_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS issues (
  issue_id BIGSERIAL PRIMARY KEY, repo_id BIGINT NOT NULL REFERENCES repositories(repo_id) ON DELETE CASCADE,
  reporter_id BIGINT NOT NULL REFERENCES users(user_id), title VARCHAR(240) NOT NULL,
  issue_type VARCHAR(24) NOT NULL CHECK (issue_type IN ('bug','feature','documentation','question')),
  status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')), github_number INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(repo_id,github_number)
);
CREATE TABLE IF NOT EXISTS pull_requests (
  pr_id BIGSERIAL PRIMARY KEY, repo_id BIGINT NOT NULL REFERENCES repositories(repo_id) ON DELETE CASCADE,
  author_id BIGINT NOT NULL REFERENCES users(user_id), title VARCHAR(240) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open','merged','closed')), github_number INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(repo_id,github_number)
);
CREATE TABLE IF NOT EXISTS stars (
  user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  repo_id BIGINT NOT NULL REFERENCES repositories(repo_id) ON DELETE CASCADE,
  starred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(user_id,repo_id)
);
CREATE TABLE IF NOT EXISTS repository_files (
  file_id BIGSERIAL PRIMARY KEY, repo_id BIGINT NOT NULL REFERENCES repositories(repo_id) ON DELETE CASCADE,
  file_path TEXT NOT NULL, file_type VARCHAR(32) NOT NULL, size_bytes INTEGER NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  content_excerpt TEXT NOT NULL DEFAULT '', content_embedding VECTOR(384), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(repo_id,file_path)
);
CREATE TABLE IF NOT EXISTS audit_events (
  event_id BIGSERIAL PRIMARY KEY, actor_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  event_type VARCHAR(60) NOT NULL, entity_type VARCHAR(60) NOT NULL, entity_id BIGINT,
  details JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_repositories_visibility ON repositories(visibility);
CREATE INDEX IF NOT EXISTS idx_repositories_language ON repositories(primary_language);
CREATE INDEX IF NOT EXISTS idx_repositories_stars ON repositories(stars_count DESC);
CREATE INDEX IF NOT EXISTS idx_commits_repo_date ON commits(repo_id,committed_at DESC);
CREATE INDEX IF NOT EXISTS idx_issues_repo_status ON issues(repo_id,status);
CREATE INDEX IF NOT EXISTS idx_pull_requests_repo_status ON pull_requests(repo_id,status);
CREATE INDEX IF NOT EXISTS idx_repository_members_user ON repository_members(user_id);
CREATE INDEX IF NOT EXISTS idx_repository_embedding ON repositories USING hnsw (summary_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_file_embedding ON repository_files USING hnsw (content_embedding vector_cosine_ops);
CREATE OR REPLACE VIEW repository_activity_view AS
SELECT r.repo_id,r.full_name,r.primary_language,r.visibility,r.stars_count,r.forks_count,
       COUNT(DISTINCT c.commit_id) AS commit_count,COUNT(DISTINCT i.issue_id) AS issue_count,
       COUNT(DISTINCT p.pr_id) AS pull_request_count
FROM repositories r LEFT JOIN commits c USING(repo_id) LEFT JOIN issues i USING(repo_id)
LEFT JOIN pull_requests p USING(repo_id) GROUP BY r.repo_id;
CREATE OR REPLACE FUNCTION count_repo_commits(target_repo BIGINT)
RETURNS BIGINT LANGUAGE SQL STABLE AS $$ SELECT COUNT(*) FROM commits WHERE repo_id=target_repo; $$;
CREATE OR REPLACE FUNCTION record_star_count() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN UPDATE repositories SET stars_count=stars_count+1,updated_at=NOW() WHERE repo_id=NEW.repo_id; RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_star_count ON stars;
CREATE TRIGGER trg_star_count AFTER INSERT ON stars FOR EACH ROW EXECUTE FUNCTION record_star_count();
