# Orbit repository health checks

Orbit's repository health view turns GitHub repository metadata and recent activity into checks and suggested next steps. Treat each result as a signal about the information GitHub exposes, not as a full code or security audit.

## What the checks mean

- **Description:** Checks whether the repository has a GitHub description. A missing description makes the project's purpose harder to discover; Orbit does not judge whether the text is accurate.
- **Topics:** Checks whether GitHub topics are set. Add a few specific tags that describe the project's domain and tools.
- **License:** Checks whether GitHub reports a repository license. Choose a license that matches how you want others to use the project.
- **Code activity:** Uses GitHub's reported push activity as a freshness signal. A recent push does not guarantee quality, and an older push does not by itself mean the project is unhealthy.
- **Project context:** Uses available repository information such as its README and metadata. If Orbit says context is missing, sync the repository and check that the README is present on its default branch.

## How to act on a result

1. Read the evidence text under the check to see what Orbit actually received from GitHub.
2. Address missing repository metadata in GitHub when that metadata is useful to people discovering the project.
3. Sync the repository again in Orbit to refresh saved repository information.
4. Use Orbit's repository analysis for a broader explanation, and verify recommendations against the source files before making code changes.

## Limits

Health results are based on the data Orbit has synced and the checks it can verify. They do not prove that code builds, that tests pass, or that a deployment is working. A missing value means Orbit did not find that evidence in the synced data; it does not necessarily mean the project has no such information elsewhere.
