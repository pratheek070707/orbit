import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { canReadRepository, getGithubToken, getRepositoryById } from "@/lib/mongo";

type Context = { params: Promise<{ id: string }> };
type GithubUser = { login: string; avatar_url?: string; html_url?: string; contributions?: number; name?: string | null };
type GithubPull = { number: number; title: string; html_url: string; user?: GithubUser; updated_at: string; state: string; merged_at?: string | null };

export async function GET(_request: Request, context: Context) {
  try {
    const user = await requireUser();
    const id = Number((await context.params).id);
    if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: "Repository not found." }, { status: 404 });
    const repository = await getRepositoryById(id);
    if (!repository || !(await canReadRepository(repository, user))) return NextResponse.json({ error: "Repository not found." }, { status: 404 });
    const token = await getGithubToken(user.user_id) ?? process.env.GITHUB_TOKEN;
    const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const base = `https://api.github.com/repos/${repository.full_name}`;
    const get = async <T,>(path: string): Promise<{ data: T | null; status: number }> => {
      const response = await fetch(`${base}${path}`, { headers, cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (!response.ok) return { data: null, status: response.status };
      return { data: await response.json() as T, status: response.status };
    };
    const [contributorsResult, collaboratorsResult, branchesResult, pullsResult] = await Promise.all([
      get<GithubUser[]>("/contributors?per_page=30"), get<GithubUser[]>("/collaborators?affiliation=direct&per_page=30"),
      get<Array<{ name: string; protected: boolean; commit?: { sha: string } }>>("/branches?per_page=50"),
      get<GithubPull[]>("/pulls?state=all&sort=updated&direction=desc&per_page=8"),
    ]);
    const pulls = pullsResult.data ?? [];
    const reviewRows = await Promise.all(pulls.slice(0, 5).map(async (pull) => {
      const result = await get<Array<{ user?: GithubUser; state: string; submitted_at: string; html_url: string }>>(`/pulls/${pull.number}/reviews?per_page=30`);
      return (result.data ?? []).map((review) => ({ ...review, pullNumber: pull.number, pullTitle: pull.title, pullUrl: pull.html_url }));
    }));
    const reviews = reviewRows.flat().filter((review) => review.state !== "PENDING").sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime()).slice(0, 30);
    const reviewers = new Map<string, { login: string; avatar_url?: string; html_url?: string; reviews: number; approvals: number; requestedChanges: number }>();
    for (const review of reviews) {
      const login = review.user?.login;
      if (!login || review.state === "COMMENTED") continue;
      const previous = reviewers.get(login) ?? { login, avatar_url: review.user?.avatar_url, html_url: review.user?.html_url, reviews: 0, approvals: 0, requestedChanges: 0 };
      previous.reviews += 1;
      if (review.state === "APPROVED") previous.approvals += 1;
      if (review.state === "CHANGES_REQUESTED") previous.requestedChanges += 1;
      reviewers.set(login, previous);
    }
    return NextResponse.json({ repository: repository.full_name, contributors: contributorsResult.data ?? [], collaborators: collaboratorsResult.data ?? [], collaboratorsAvailable: collaboratorsResult.status === 200, branches: branchesResult.data ?? [], recentPullRequests: pulls, reviews, reviewers: [...reviewers.values()].sort((a, b) => b.reviews - a.reviews), restricted: { collaborators: collaboratorsResult.status === 403 || collaboratorsResult.status === 404 } });
  } catch (error) { return apiError(error); }
}
