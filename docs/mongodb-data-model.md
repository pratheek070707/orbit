# Orbit MongoDB data model

Orbit uses MongoDB to persist application data that supports accounts and repository intelligence. Repository information synchronized from GitHub is kept separately from Orbit account and preference records.

## Data areas

- User and Orbit account records support application identities. Passwords must be stored as secure password hashes, never as plaintext.
- GitHub account linkage and authorization metadata connect an Orbit user to the GitHub identity they approved. OAuth tokens are secrets and must be encrypted at rest.
- Repository and repository snapshot documents store synchronized repository metadata and analysis inputs.
- Preferences and project records support workspace customization and organization.
- Audit events record selected security-sensitive actions for accountability.

Only persist information needed by Orbit. Apply per-user access checks to every read and write, and avoid copying GitHub credentials into logs or analytics. Collection names and fields should match the deployed schema.
