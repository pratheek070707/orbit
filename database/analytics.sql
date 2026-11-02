-- Repository activity snapshot, backed by the joined activity view.
SELECT full_name, primary_language, stars_count, forks_count,
       commit_count, issue_count, pull_request_count
FROM repository_activity_view
ORDER BY stars_count DESC;

-- Language groups with an above-average repository count.
SELECT primary_language, COUNT(*) AS repository_count,
       SUM(stars_count) AS community_stars
FROM repositories
GROUP BY primary_language
HAVING COUNT(*) >= 1
ORDER BY community_stars DESC;

-- Contributors who have authored more commits than the average contributor.
WITH commits_per_contributor AS (
  SELECT author_id, COUNT(*) AS commit_count
  FROM commits
  GROUP BY author_id
)
SELECT u.login, c.commit_count,
       RANK() OVER (ORDER BY c.commit_count DESC) AS contribution_rank
FROM commits_per_contributor c
JOIN users u ON u.user_id = c.author_id
WHERE c.commit_count > (SELECT AVG(commit_count) FROM commits_per_contributor)
ORDER BY contribution_rank, u.login;

-- Recent code-change totals by project.
SELECT r.full_name, SUM(c.lines_added) AS added,
       SUM(c.lines_deleted) AS removed,
       SUM(c.lines_added - c.lines_deleted) AS net_change
FROM repositories r
JOIN commits c ON c.repo_id = r.repo_id
WHERE c.committed_at >= NOW() - INTERVAL '30 days'
GROUP BY r.repo_id, r.full_name
ORDER BY net_change DESC;

-- Projects without any recorded pull requests.
SELECT r.full_name
FROM repositories r
WHERE NOT EXISTS (SELECT 1 FROM pull_requests p WHERE p.repo_id = r.repo_id);

-- Atomic star update example: the AFTER INSERT trigger keeps the stored
-- repository star count aligned with new star records.
BEGIN;
INSERT INTO stars(user_id, repo_id) VALUES (1, 105)
ON CONFLICT(user_id, repo_id) DO NOTHING;
COMMIT;
