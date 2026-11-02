# Project report

**GitHub Repository Intelligence & Developer Ecosystem Mapper**

## 1. Introduction

GitHub hosts a large and changing collection of software repositories. Developers often need to compare projects by programming language, activity, topics, and contributors before choosing a dependency or exploring a technology. This mini project builds a repository intelligence workspace that collects public repository metadata and presents it in a searchable dashboard. It combines a relational database for consistent records with vector search for discovering projects whose descriptions and README content are related.

The application is called Orbit in its interface. It uses Next.js with TypeScript for the user interface and server-side APIs, PostgreSQL for structured data, and pgvector for similarity search. The imported source data is limited to public repositories. Demonstration records are fictional and are intended to make the dashboard useful before a user imports a project.

## 2. Problem definition

Repository information is spread across project pages, contributor activity, issue lists, pull requests, and README files. Reviewing each repository separately makes comparison slow. Simple keyword search also misses repositories described with related but different terms. The system therefore needs a single dashboard that can collect public repository metadata, summarize activity, filter by language and visibility, and provide a semantic similarity option while preserving access controls and a trace of important changes.

### 2.1 Objectives

- Build a responsive dashboard for repository discovery and activity review.
- Import a public GitHub repository and selected recent activity using the GitHub REST API.
- Store users, repositories, members, commits, issues, pull requests, stars, file excerpts, and audit events in a normalized relational schema.
- Provide keyword and cosine-similarity search.
- Protect API routes with signed sessions, validated inputs, role checks, and parameterized SQL.
- Demonstrate database constraints, indexes, a view, a function, a trigger, aggregation, subqueries, CTEs, window ranking, and transactions.

### 2.2 Scope and limitations

The application imports public repositories only and retains a bounded sample of recent activity (up to 20 commits, issues, and pull requests per import). It does not perform GitHub OAuth, clone repositories, or index complete source trees. Its 384-dimensional embeddings are deterministic hashed-token vectors with token bigrams; this is a reproducible educational baseline, not a trained language model. A deployed version should use a managed pgvector-enabled PostgreSQL service, HTTPS, a strong secret, secure credential management, and operational backups.

## 3. Requirements and architecture

Functional requirements include authenticated sign-in, a dashboard, repository list and filters, keyword and semantic search, public repository import, role-aware updates, reversible archive/restore, and an audit trail. The dashboard contains repository and activity metrics, language distribution, contributor information, and a recent activity view. Admin and maintainer roles can see all repositories; other roles see public repositories and repositories they own or belong to. Only authorized roles may import or change repository records.

Non-functional requirements include responsive rendering, server-side secret handling, HTTP-only SameSite session cookies, input validation, database constraints, and safe parameterized queries. A signed session has a bounded lifetime. The GitHub API token is optional and used only by server routes to improve public API rate limits.

The architecture is a browser-facing Next.js application with route handlers as the API layer. Route handlers check authentication and authorization before querying PostgreSQL. Repository import retrieves GitHub data on the server, then writes related records in a transaction. The detailed architecture and ER model are included in `docs/architecture-and-erd.md`.

## 4. ER model and relational mapping

The main entities are USERS, REPOSITORIES, COMMITS, ISSUES, PULL_REQUESTS, REPOSITORY_FILES, and AUDIT_EVENTS. REPOSITORY_MEMBERS represents the many-to-many relationship between users and repositories and stores a project-specific role. STARS represents users starring repositories and prevents duplicate stars with a composite key.

Relational mapping uses a primary key for each entity and foreign keys from activity records to repositories and users. Repository ownership is a required user reference. `full_name` and GitHub activity identifiers are unique where appropriate. Check constraints limit roles, visibility, activity statuses, issue categories, and non-negative counts. Cascading deletion is used for dependent repository records; audit actor references are set to null if a user is removed. Vector embeddings are stored on repository summaries and file excerpts as `VECTOR(384)`.

## 5. Data dictionary

| Relation | Key attributes | Purpose |
|---|---|---|
| users | user_id PK; login/email unique; role, status | Application identities and global roles |
| repositories | repo_id PK; owner_id FK; full_name unique; vector summary | Repository metadata, visibility, counts, topics, README |
| repository_members | (repo_id,user_id) PK/FK; role | Per-repository access membership |
| commits | commit_id PK; repo_id and author_id FK; commit_hash unique | Recent commit activity |
| issues | issue_id PK; repo_id and reporter_id FK; optional GitHub number | Tracked issue summaries |
| pull_requests | pr_id PK; repo_id and author_id FK; optional GitHub number | Pull request summaries and status |
| stars | (user_id,repo_id) PK/FK | User-to-repository stars |
| repository_files | file_id PK; repo_id FK; unique repo/path; vector excerpt | Bounded indexed file excerpts |
| audit_events | event_id PK; optional actor FK; JSONB details | Important changes and imports |

## 6. Database implementation

`database/schema.sql` creates the pgvector extension, tables, constraints, conventional indexes, HNSW cosine indexes, a repository activity view, a commit-count function, and a star-count trigger. The indexes support filtering by language and visibility, recent activity lookup, membership checks, and vector nearest-neighbor search. The view aggregates counts from related activity tables without duplicating repository rows.

The trigger increments the denormalized star count after a new star row is inserted. The seed script resets displayed star totals to their demonstration values after creating sample star relations. `scripts/setup-db.mjs` applies schema and seed data and assigns deterministic vectors to the sample repository summaries and file excerpts.

## 7. Important queries and advanced concepts

The supplied `database/analytics.sql` illustrates the following:

1. **View and joins:** repository activity across commits, issues, and pull requests.
2. **Grouping and HAVING:** repository counts and total stars grouped by language.
3. **CTE and window function:** contributor ranking by commit count.
4. **Aggregate calculation:** additions, deletions, and net code changes over the last 30 days.
5. **Correlated existence check:** projects without pull requests using `NOT EXISTS`.
6. **Transaction and trigger:** inserting a star atomically and maintaining its count.
7. **Vector index:** HNSW index using `vector_cosine_ops`, queried with cosine distance for semantic search.

In the web API, user-supplied values are passed as parameters rather than concatenated into SQL. Database permissions are scoped by role and repository access.

## 8. Frontend and API development

The frontend is a responsive repository dashboard with a restrained dark navigation rail, bright workspace canvas, compact metric cards, charts, contributor summaries, searchable repository rows, import dialog, and archive/restore controls. Authentication presents demo credentials for local evaluation. The preview-only sample mode is enabled by a development query parameter and is disabled in production.

The API provides authentication routes, a dashboard summary route, repository list/search/create/update routes, and a GitHub import route. Public GitHub import accepts an `owner/name` identifier, fetches bounded metadata, and stores the data in a transaction. Semantic search computes a deterministic vector from the query and ranks accessible repositories by cosine distance. Passwords are stored with bcrypt; session integrity uses HMAC-SHA256 and a server-only secret.

## 9. Verification and results

The production Next.js build completed successfully, including TypeScript checks and static route generation. The local dashboard preview was opened and visually reviewed in a browser. The configured environment did not include Docker or a running PostgreSQL service, so database initialization, live API/database integration, GitHub rate-limit behavior, and role scenarios were not executed in this environment. To complete those checks locally, start the included database service, run `pnpm db:setup`, and exercise the documented routes with the seeded accounts.

| Check | Result |
|---|---|
| Production application build and type check | Passed |
| Dashboard visual review | Completed |
| PostgreSQL/pgvector runtime integration | Not run; local Docker service unavailable |
| GitHub import against live API | Not run in this environment |
| Authentication and role flows against live database | Not run in this environment |

The local setup instructions and sample credentials are in `README.md`. Before deployment, replace the sample password and `AUTH_SECRET`, configure a secure database, and provide HTTPS.

## 10. Conclusion and future work

The project demonstrates an end-to-end repository intelligence application backed by a relational database and vector similarity index. It connects a polished dashboard to authenticated API routes, provides public GitHub import, and documents database constraints and advanced query concepts. Its main educational value lies in showing how structured data, access rules, analytics, and vector retrieval can coexist in one application.

Future work includes GitHub OAuth with account linking, background imports, pagination and incremental synchronization, full language statistics, repository file indexing with safe size limits, real transformer embeddings, richer role management, audit review screens, automated database integration checks, and deployment to a managed PostgreSQL/pgvector platform.

## References

1. PostgreSQL Documentation, https://www.postgresql.org/docs/
2. pgvector, https://github.com/pgvector/pgvector
3. GitHub REST API Documentation, https://docs.github.com/en/rest
4. Next.js Documentation, https://nextjs.org/docs
5. OWASP Cheat Sheet Series: Session Management and Password Storage, https://cheatsheetseries.owasp.org/

## Appendix A. Team details

| Student | SRN | Contribution |
|---|---|---|
| Pratheek P Shettigar | PES2UG24CS650 | UI, API integration, database implementation, report |
| Akasha | PES2UG25CS803 | Requirements, schema review, documentation, evaluation |

**Course / section:** To be filled from the final course allocation.  
**Faculty guide:** To be filled with the assigned guide's name.  
**Academic year:** To be confirmed by the team.
