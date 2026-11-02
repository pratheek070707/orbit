# orbit

## GitHub Repository Intelligence & Developer Ecosystem Mapper

Orbit turns GitHub repository data into a clearer view of projects and the developer ecosystem around them. It combines repository management with activity and language analytics, evidence-based project health, AI-assisted explanations, and a relationship map for repositories, contributors, languages, and topics. MongoDB stores Orbit accounts, repository records, pins, audit events, and synced repository snapshots. GitHub sign-in uses OAuth; Orbit never collects GitHub passwords.

## Current capabilities

- Orbit account registration and username/password sign-in, with salted scrypt password hashes and throttled failed attempts.
- Google OAuth sign-in with state validation; add Google OAuth app credentials to enable the provider.
- GitHub OAuth sign-in with CSRF state and PKCE, plus GitHub linking for Orbit or Google accounts. Orbit never collects a GitHub password.
- Encrypted storage of the GitHub access token, used server-side for repository imports.
- On first workspace load after GitHub sign-in, automatically sync up to 1,000 repositories visible to that account. The 100 most recently updated also get language and recent commit snapshots for analytics.
- Import public or authorized private repositories by `owner/name`, including metadata, recent commits, open issues, pull requests, topics, languages, and README.
- Create real GitHub repositories, issues, and pull requests through the connected account.
- Browse and edit repository files, create and delete files as GitHub commits, and review default-branch contents.
- Browse live pull requests, issues, repository analytics, branches, collaborators, reviews, and contributor activity.
- Search repositories by keywords or semantic similarity; filter and sort saved repositories.
- Review workspace metrics, activity, contributors, language mix, and a live GitHub contribution calendar.
- Map repository, language, topic, and contributor relationships in the ecosystem view.
- Review evidence-based project health checks and suggested next steps; optionally ask an AI provider about a synced repository.
- Pin, archive, restore, and update saved repository records; record imports and changes in the audit log.

The current OAuth flow asks for `read:user`, `user:email`, and `repo` access. This supports user identity and repository operations on repositories the authorizing account can access. Organization administration is not requested.

## Run locally

Requirements: Node.js 20.19+, pnpm, and a GitHub OAuth App. Orbit starts a local, persistent MongoDB development server automatically when `MONGODB_URI` points to localhost and no local MongoDB is already running. Atlas is used when `MONGODB_URI` is set to an Atlas connection string.

1. In your GitHub OAuth App settings, set the callback URL to `http://localhost:3002/api/auth/github/callback` and save the application.
2. Copy `.env.example` to `.env`. Fill in `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, the MongoDB URI, and a random `AUTH_SECRET` of at least 32 characters. To enable Google sign-in, create an OAuth client in Google Cloud Console and set its callback URL to `http://localhost:3002/api/auth/google/callback`, then fill in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Optional: set `AI_API_KEY` and `AI_MODEL` for generated repository explanations. Keep secrets in this local file; do not paste them into chat.
3. For Atlas, resume the cluster, create or use a database user, and allow your development IP in the network access list. For local development, keep `ORBIT_LOCAL_MONGO=true`; the first start downloads the MongoDB server binary and stores database files under `.runtime/mongodb`.
4. Install packages with `pnpm install` (or `npm install`).
5. Start Orbit with `pnpm dev` or run `Start-Demo.ps1` in PowerShell. Open `http://localhost:3002` and choose **Continue with GitHub**. Use `localhost` in the browser; `0.0.0.0` is the server bind address.

MongoDB stores each account and repository as documents, with indexes created automatically at connection time. The configured database name is `github_repository_intelligence`. Synced repository snapshots retain metadata, languages, README content, and recent commits, issues, pull requests, and analytics. Search embeddings are computed locally and ranked in Orbit; Atlas Vector Search is not required. The SQL files under `database/` remain as coursework reference material and are not used by Orbit's runtime.

## Configuration

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB Atlas or local MongoDB URI |
| `MONGODB_DATABASE` | MongoDB database name (default `orbit`) |
| `AUTH_SECRET` | Session signing and GitHub token encryption key; at least 32 characters |
| `APP_URL` | Orbit base URL; local value is `http://localhost:3002` |
| `GITHUB_CLIENT_ID` | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | Server-only GitHub OAuth App client secret |
| `GOOGLE_CLIENT_ID` | Optional Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Optional server-only Google OAuth client secret |
| `GITHUB_TOKEN` | Optional server token for public API rate limits |
| `AI_API_BASE_URL` | OpenAI-compatible chat API base URL for AI questions |
| `AI_API_KEY` | Optional secret for the AI provider; not required for health checks |
| `AI_MODEL` | Model name accepted by the configured AI provider |
| `SEED_DEMO_DATA` | Set to `true` to load the fictional educational seed dataset |

## Main routes

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Check MongoDB, GitHub OAuth, and optional AI configuration without returning secret values |
| `GET /api/auth/github` | Start OAuth sign-in |
| `POST /api/auth/credentials` | Register or sign in with Orbit credentials |
| `GET /api/auth/google` | Start Google OAuth sign-in |
| `GET /api/auth/github/callback` | Validate state, exchange code, and issue a session |
| `GET /api/auth/session` | Return the current Orbit user |
| `POST /api/auth/logout` | Clear the session cookie |
| `GET /api/dashboard` | Return workspace metrics, activity, and contribution calendar |
| `GET /api/github/repos?sync=1` | Sync visible repositories and recent language/commit data from the connected GitHub account |
| `GET /api/repos/:id/insights` | Load live GitHub analytics and save them in MongoDB |
| `GET`, `PUT`, and `DELETE /api/repos/:id/files` | Browse and preview files; create, update, or delete files with real GitHub commits |
| `GET /api/repos/:id/collaboration` | Summarize contributors, collaborators, branches, and recent reviews |
| `GET /api/ecosystem` | Build the workspace's repository relationship graph from synced data |
| `GET /api/intelligence` | Generate repository summaries, health signals, and recommendations |
| `POST /api/intelligence` | Ask a configured AI provider a repository question |
| `PATCH /api/github/issues` and `/api/github/pulls` | Edit, close, or reopen GitHub work items; PR merge requires an explicit confirmation flag |
| `POST /api/github/issues/comment` | Add a GitHub issue comment |
| `POST /api/github/pulls/review` | Submit an approval, comment, or change request on a pull request |
| `GET /api/repos` | Filter and search repositories |
| `POST /api/github/import` | Import a repository visible to the signed-in GitHub user |
| `PATCH /api/repos/:id` | Update details or archive/restore a repository |

## Data model and limits

MongoDB collections store accounts, repositories, audit events, and flexible `repository_snapshots` documents with nested GitHub metadata and activity. Imports retain a bounded set of recent activity records; Orbit does not clone repositories or index full source trees. The contribution calendar comes directly from GitHub for the signed-in account.

Orbit links to GitHub account settings for organization creation because GitHub documents no REST endpoint for creating an organization. After creation, Orbit can create repositories under an organization through the repository owner field when the authorizing account has permission. GitHub's OAuth consent and the account's repository permissions determine which organizations and private repositories can be accessed. AI answers require an optional AI provider key; health signals and repository recommendations use real synced repository data without it.
