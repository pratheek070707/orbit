# Orbit pull request workflow

Orbit can display pull requests from GitHub repositories available to the connected account. The pull request list and detail view reflect the status and metadata returned by GitHub.

## Review and merge

1. Choose the repository and inspect the pull request title, author, base branch, and source branch.
2. Review the GitHub conversation, checks, and changed files before merging.
3. Merge only when GitHub reports the pull request is mergeable and the account has permission.
4. Refresh Orbit to load the updated GitHub state.

A merge is performed by GitHub and follows that repository's branch protection rules. Orbit should report the result returned by GitHub; a UI status alone is not evidence that a merge occurred.
