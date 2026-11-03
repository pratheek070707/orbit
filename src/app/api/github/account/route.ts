import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getGithubToken } from "@/lib/mongo";
import { apiError } from "@/lib/http";

const headers = (token: string) => ({ Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" });
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const token = await getGithubToken(user.user_id);
    if (!token) return NextResponse.json({ error: "Connect a GitHub account to load this Orbit view." }, { status: 409 });
    const type = request.nextUrl.searchParams.get("type");
    const endpoints: Record<string, string> = { organizations: "/user/orgs?per_page=100", stars: "/user/starred?per_page=100&sort=created", gists: "/gists?per_page=100" };
    if (!type || !(type in endpoints)) return NextResponse.json({ error: "Choose organizations, stars, or gists." }, { status: 400 });
    let rows: Array<Record<string, unknown>> = [];
    let grantedScopes = "";
    const pages = type === "organizations" ? 10 : 1;
    for (let page = 1; page <= pages; page++) {
      const endpoint = type === "organizations" ? `/user/orgs?per_page=100&page=${page}` : endpoints[type];
      const response = await fetch(`https://api.github.com${endpoint}`, { headers: headers(token), cache: "no-store", signal: AbortSignal.timeout(12000) });
      grantedScopes = response.headers.get("x-oauth-scopes") ?? grantedScopes;
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = type === "organizations" && (response.status === 403 || response.status === 404)
          ? "GitHub requires organization read access. Reconnect GitHub from Orbit to grant the read:org permission."
          : typeof data.message === "string" ? data.message : "Could not load this account data.";
        return NextResponse.json({ error: message }, { status: response.status });
      }
      if (Array.isArray(data)) rows.push(...data as Array<Record<string, unknown>>);
      if (type !== "organizations" || !Array.isArray(data) || data.length < 100) break;
    }
    if (type === "organizations" && grantedScopes && !grantedScopes.split(",").map(scope => scope.trim()).some(scope => scope === "read:org" || scope === "user")) {
      return NextResponse.json({ error: "Your GitHub connection does not include organization access yet. Reconnect GitHub from Orbit and approve the read:org permission." }, { status: 403 });
    }
    const organizationItems = type === "organizations" ? await Promise.all(rows.map(async (item) => {
      const login = String(item.login ?? "");
      const detailsResponse = await fetch(`https://api.github.com/orgs/${encodeURIComponent(login)}`, { headers: headers(token), cache: "no-store", signal: AbortSignal.timeout(10000) }).catch(() => null);
      const details = detailsResponse?.ok ? await detailsResponse.json() as Record<string, unknown> : {};
      return { login, name: details.name ?? item.name, description: details.description ?? item.description, avatar_url: item.avatar_url, repo_count: details.public_repos ?? 0, url: item.html_url };
    })) : null;
    const items = organizationItems ?? rows.map((item) => {
      if (type === "stars") { const repo = item as Record<string, unknown>; const owner = (repo.owner ?? {}) as Record<string, unknown>; return { name: repo.name, full_name: repo.full_name, description: repo.description, language: repo.language, stars: repo.stargazers_count, url: repo.html_url, owner: owner.login }; }
      const files = (item.files ?? {}) as Record<string, Record<string, unknown>>;
      return { id: item.id, description: item.description, public: item.public, updated_at: item.updated_at, url: item.html_url, files: Object.keys(files).slice(0, 4) };
    });
    return NextResponse.json({ items });
  } catch (error) { return apiError(error); }
}
