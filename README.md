# GitHub Repository Intelligence & Developer Ecosystem Mapper

Orbit is a full-stack repository intelligence workspace for discovering public GitHub projects and understanding their activity, contributors, languages, and related code. It combines a Next.js dashboard with a PostgreSQL data model and pgvector semantic retrieval.

## What it does

- Imports public GitHub repositories by `owner/name`, including repository metadata, up to 20 recent commits, open issues, pull requests, topics, and README content.
- Shows repository, star, commit, contributor, language, and activity summaries in a responsive dashboard.
- Searches repository names and topics with keyword search or finds related projects with cosine similarity over stored summary vectors.
- Provides role-aware sessions and reversible repository archiving.
- Keeps an audit trail of project imports and updates.

The sample database contains fictional demonstration records so the dashboard has useful content before importing a live project. The sample login is `pratheek@example.com` with password `demo1234`; change the password and `AUTH_SECRET` before any deployment.

## Technology choices

- **Next.js and TypeScript:** one application contains the responsive interface and server-side route handlers.
- **PostgreSQL:** repositories, users, commits, issues, pull requests, members, stars, and audit events have explicit keys, constraints, and relational links.
- **pgvector:** repository and README summaries are stored as 384-dimensional vectors and ranked with cosine distance. The included embedding function uses deterministic hashed tokens, so it needs no external model API. It is a lightweight semantic-search demonstration; a production installation can replace it with a trained embedding model without changing the vector storage pattern.
- **GitHub REST API:** public repository metadata and activity are fetched server-side. Set `GITHUB_TOKEN` to raise the unauthenticated API rate limit. Private repository import is intentionally disabled because the app does not bind a GitHub OAuth identity to a local account.

## Run locally

Requirements: Node.js 20 or newer, pnpm or npm, and Docker Desktop with Compose.

1. Copy `.env.example` to `.env`. Replace `AUTH_SECRET` with a random value of at least 32 characters. `DATABASE_URL` is configured for the included local database.
2. Start PostgreSQL with pgvector:

   ```sh
   docker compose up -d db
   ```

3. Install packages and create the schema plus sample data:

   ```sh
   pnpm install
   pnpm db:setup
   ```

   To use npm, run `npm install` and `npm run db:setup` instead.

4. Start the app:

   ```sh
   pnpm dev
   ```

5. Open `http://localhost:3000` and sign in with the sample credentials above.

The database schema is also mounted into the PostgreSQL container's first-run initialization directory. `pnpm db:setup` can be re-run safely to apply idempotent schema statements and refresh the demonstration vectors. To reset a disposable local database, stop the service and remove its named `mapper_data` volume before starting again.

## Configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_SECRET` | HMAC key used to sign short-lived HTTP-only session cookies |
| `GITHUB_TOKEN` | Optional GitHub token for public API rate limits; never expose it to the browser |
| `APP_URL` | Base URL used when configuring a deployment |

Do not commit `.env` or database credentials. In production, use a managed PostgreSQL service with pgvector, a strong secret from the deployment platform, HTTPS, and backups. The database connection enforces certificate verification in production.

## Data model

`database/schema.sql` defines users, repositories, repository memberships, commits, issues, pull requests, stars, repository files, and audit events. It also defines the `repository_activity_view`, the `count_repo_commits` function, the star-count trigger, conventional indexes, and HNSW cosine indexes for vector retrieval. `database/seed.sql` supplies the demonstration records. `database/analytics.sql` contains representative joins, grouping, CTE, subquery, ranking, and transaction examples.

## Access model

The starter dataset includes admin, developer, maintainer, and reviewer roles. Passwords are stored using bcrypt hashes. Sessions are signed with HMAC-SHA256 and sent in HTTP-only, SameSite cookies. Admin and maintainer roles can see all repositories; other users see public repositories, repositories they own, or repositories where they are members. Only admins can make unrestricted dashboard updates; destructive deletion is not exposed. Archive changes are reversible.

## Main routes

| Route | Purpose |
| --- | --- |
| `POST /api/auth/login` | Authenticate a seeded user and issue a session cookie |
| `GET /api/auth/session` | Return the current session user |
| `POST /api/auth/logout` | Clear the session cookie |
| `GET /api/dashboard` | Return scoped workspace metrics and activity summaries |
| `GET /api/repos` | Filter, keyword-search, or semantically search accessible repositories |
| `POST /api/repos` | Add a repository record for a developer or admin |
| `POST /api/github/import` | Import public GitHub repository data and recent activity |
| `PATCH /api/repos/:id` | Update details or archive/restore a repository |

## Course report materials

The report follows the supplied DBMS sample structure and includes the problem definition, objectives, scope, architecture, schema, data dictionary, important queries, application screenshots, implementation details, evaluation, conclusion, future work, and references. See `REPORT.md` for the project write-up and `docs/` for diagrams.
