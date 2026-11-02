# System architecture

```mermaid
flowchart LR
  U[Developer / Reviewer / Admin] --> UI[Next.js responsive dashboard]
  UI --> AUTH[Route handlers + HMAC session]
  AUTH --> PG[(PostgreSQL + pgvector)]
  AUTH --> GH[GitHub REST API: public repositories]
  PG --> REL[Relational records, constraints, audit]
  PG --> VEC[384-dimensional vectors + HNSW cosine index]
```

The browser only talks to same-origin Next.js route handlers. Route handlers validate inputs, verify the signed session, enforce access rules, and then use parameterized PostgreSQL statements. The public GitHub API is called server-side during an import. The optional GitHub token is kept in the server environment and is never sent to the client.

# Entity relationship model

```mermaid
erDiagram
  USERS ||--o{ REPOSITORIES : owns
  USERS ||--o{ REPOSITORY_MEMBERS : receives
  REPOSITORIES ||--o{ REPOSITORY_MEMBERS : grants
  USERS ||--o{ COMMITS : authors
  REPOSITORIES ||--o{ COMMITS : contains
  USERS ||--o{ ISSUES : reports
  REPOSITORIES ||--o{ ISSUES : tracks
  USERS ||--o{ PULL_REQUESTS : authors
  REPOSITORIES ||--o{ PULL_REQUESTS : reviews
  USERS ||--o{ STARS : gives
  REPOSITORIES ||--o{ STARS : receives
  REPOSITORIES ||--o{ REPOSITORY_FILES : indexes
  USERS o|--o{ AUDIT_EVENTS : performs
```

`repository_members` and `stars` are associative relations with composite primary keys. Repository activity is summarized by a view; vector columns are attached to a repository summary or indexed file excerpt. Full definitions and constraints are in `database/schema.sql`.
