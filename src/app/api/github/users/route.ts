import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getGithubToken } from "@/lib/mongo";
import { apiError } from "@/lib/http";

const base = "https://api.github.com";
const common = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const token = await getGithubToken(user.user_id);
    const headers = { ...common, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const username = (request.nextUrl.searchParams.get("username") ?? "").trim();
    if (username) {
      if (!/^[A-Za-z0-9-]{1,39}$/.test(username)) return NextResponse.json({ error: "Enter a valid GitHub username." }, { status: 400 });
      const [profileResponse, repositoriesResponse, feedResponse] = await Promise.all([
        fetch(`${base}/users/${encodeURIComponent(username)}`, { headers, cache: "no-store", signal: AbortSignal.timeout(12000) }),
        fetch(`${base}/users/${encodeURIComponent(username)}/repos?type=owner&sort=updated&direction=desc&per_page=12`, { headers, cache: "no-store", signal: AbortSignal.timeout(12000) }),
        fetch(`${base}/users/${encodeURIComponent(username)}/events/public?per_page=30`, { headers, cache: "no-store", signal: AbortSignal.timeout(12000) }),
      ]);
      const profile = await profileResponse.json().catch(() => ({})) as Record<string, unknown>;
      if (!profileResponse.ok) return NextResponse.json({ error: typeof profile.message === "string" ? profile.message : "Could not load this GitHub profile." }, { status: profileResponse.status });
      const repositories = repositoriesResponse.ok ? await repositoriesResponse.json() as Array<Record<string, unknown>> : [];
      const events = feedResponse.ok ? await feedResponse.json() as Array<Record<string, unknown>> : [];
      const feed = events.map((event) => {
        const payload = (event.payload ?? {}) as Record<string, unknown>;
        const repo = (event.repo ?? {}) as Record<string, unknown>;
        const type = String(event.type ?? "Activity");
        let summary = type.replace(/Event$/, "").replace(/([A-Z])/g, " $1").trim();
        if (type === "PushEvent") summary = `Pushed ${Number(payload.size ?? 1)} commit${Number(payload.size ?? 1) === 1 ? "" : "s"}`;
        else if (type === "WatchEvent") summary = "Starred a repository";
        else if (type === "IssuesEvent") summary = `${String(payload.action ?? "updated")} an issue`;
        else if (type === "PullRequestEvent") summary = `${String(payload.action ?? "updated")} a pull request`;
        else if (type === "CreateEvent") summary = `Created ${String(payload.ref_type ?? "a project")}`;
        else if (type === "ForkEvent") summary = "Forked a repository";
        return { id: String(event.id ?? `${event.created_at}-${repo.name}`), type, summary, repository: String(repo.name ?? "Repository"), created_at: String(event.created_at ?? "") };
      });
      return NextResponse.json({
        profile: { login: profile.login, name: profile.name, avatar_url: profile.avatar_url, bio: profile.bio, company: profile.company, location: profile.location, followers: profile.followers, following: profile.following, public_repos: profile.public_repos, created_at: profile.created_at },
        repositories: repositories.map((repo) => ({ full_name: repo.full_name, description: repo.description, language: repo.language, stars: repo.stargazers_count, forks: repo.forks_count, updated_at: repo.updated_at, html_url: repo.html_url })),
        feed,
      });
    }
    const query = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
    if (query.length < 2) return NextResponse.json({ users: [] });
    const response = await fetch(`${base}/search/users?q=${encodeURIComponent(query)}&per_page=20`, { headers, cache: "no-store", signal: AbortSignal.timeout(12000) });
    const data = await response.json().catch(() => ({})) as { items?: Array<Record<string, unknown>>; message?: string };
    if (!response.ok) return NextResponse.json({ error: data.message ?? "GitHub user search failed." }, { status: response.status });
    return NextResponse.json({ users: (data.items ?? []).map((person) => ({ login: person.login, avatar_url: person.avatar_url, type: person.type, score: person.score })) });
  } catch (error) { return apiError(error); }
}
