import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { canReadRepository, getGithubToken, getRepositoryById, repositoriesCollection, repositorySnapshots } from "@/lib/mongo";

type Context = { params: Promise<{ id: string }> };
const headers = (token: string | null) => ({ Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(token ? { Authorization: `Bearer ${token}` } : {}) });

export async function GET(request: NextRequest, context: Context) {
  try {
    const user = await requireUser();
    const id = Number((await context.params).id);
    if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: "Repository not found." }, { status: 404 });
    const repository = await getRepositoryById(id);
    if (!repository || !(await canReadRepository(repository, user))) return NextResponse.json({ error: "Repository not found." }, { status: 404 });
    const token = await getGithubToken(user.user_id) ?? process.env.GITHUB_TOKEN ?? null;
    const base = `https://api.github.com/repos/${repository.full_name}`;
    const get = async <T,>(path: string): Promise<T | null> => {
      const response = await fetch(`${base}${path}`, { headers: headers(token), cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (response.status === 202 || response.status === 204) return null;
      if (!response.ok) throw new Error(response.status === 403 ? "GitHub rate limit reached while loading repository insights." : `GitHub could not load ${repository.full_name} (HTTP ${response.status}).`);
      return response.json() as Promise<T>;
    };
    const [details, languages, contributors] = await Promise.all([
      get<{ stargazers_count: number; forks_count: number; open_issues_count: number; watchers_count: number; created_at: string; pushed_at: string; default_branch: string; html_url: string }>(""),
      get<Record<string, number>>("/languages"),
      get<{ login: string; avatar_url: string; contributions: number }[]>("/contributors?per_page=20"),
    ]);
    const bytes = Object.values(languages ?? {}).reduce((sum, count) => sum + count, 0);
    const languageRows=Object.entries(languages ?? {}).map(([name,count])=>({name,bytes:count,percentage:bytes?Math.round(count*100/bytes):0})).sort((a,b)=>b.bytes-a.bytes);
    const snapshotCollection=await repositorySnapshots();
    const snapshot=await snapshotCollection.findOne({_id:repository.full_name.toLowerCase()});
    const analyticsUpdate: Record<string, unknown> = { fullName: repository.full_name, "analytics.details": details, "analytics.languages": languageRows, analyticsUpdatedAt: new Date() };
    if (contributors !== null) {
      analyticsUpdate["analytics.contributors"] = contributors ?? [];
      analyticsUpdate["analytics.contributorsCheckedAt"] = new Date();
    }
    await snapshotCollection.updateOne({_id:repository.full_name.toLowerCase()},{$set:analyticsUpdate},{upsert:true});
    await (await repositoriesCollection()).updateOne({ repo_id: id }, { $set: { stars_count: details?.stargazers_count ?? repository.stars_count, forks_count: details?.forks_count ?? repository.forks_count, open_issues_count: details?.open_issues_count ?? repository.open_issues_count, primary_language: languageRows[0]?.name ?? repository.primary_language, language_bytes: languages ?? repository.language_bytes, updated_at: details?.pushed_at ? new Date(details.pushed_at) : repository.updated_at } });
    return NextResponse.json({ repository, details, languages: languageRows, contributors: contributors ?? [], snapshot: snapshot ? { syncedAt: snapshot.syncedAt, readme: typeof snapshot.readme === "string" ? snapshot.readme.slice(0, 6000) : "" } : null });
  } catch (error) {
    return apiError(error);
  }
}
