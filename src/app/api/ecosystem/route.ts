import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getGithubToken, repositoryWorkspaceFilter, repositoriesCollection, repositorySnapshots } from "@/lib/mongo";
import { apiError } from "@/lib/http";

type MapNode = { id: string; label: string; type: "developer" | "repository" | "language" | "topic"; value: number; url?: string };
type MapEdge = { source: string; target: string; type: "contributes" | "uses" | "tagged" | "related"; weight: number; evidence?: "GitHub contributor data" | "Recent synced commits" };
type GithubContributor = { login?: string | null; avatar_url?: string; contributions?: number };
type Snapshot = { languages?: Record<string, unknown>; recentActivity?: { commits?: Array<Record<string, unknown>> }; analytics?: { contributors?: GithubContributor[]; contributorsCheckedAt?: Date }; syncedAt?: Date };

async function mapLimit<T, R>(values: T[], limit: number, operation: (value: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      output[index] = await operation(values[index]);
    }
  }));
  return output;
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const rows = await (await repositoriesCollection()).find({ ...repositoryWorkspaceFilter(user), is_archived: false }).sort({ updated_at: -1 }).limit(60).toArray();
    const totals = { repositories: rows.length, developers: 0, languages: 0, topics: 0 };
    if (!rows.length) return NextResponse.json({ nodes: [], edges: [], totals, viewer: user.login, updatedAt: new Date().toISOString(), contributorRefresh: { refreshed: 0, attempted: 0 } });

    const snapshotCollection = await repositorySnapshots();
    const names = rows.map((row) => String(row.fullNameKey ?? row.full_name.toLowerCase()));
    const snapshots = await snapshotCollection.find({ _id: { $in: names } }, { projection: { languages: 1, recentActivity: 1, analytics: 1, syncedAt: 1 } }).toArray() as Array<Snapshot & { _id: string }>;
    const byName = new Map<string, Snapshot>(snapshots.map((snapshot) => [String(snapshot._id).toLowerCase(), snapshot]));

    let refreshed = 0;
    let attempted = 0;
    if (request.nextUrl.searchParams.get("refresh") === "1") {
      const token = await getGithubToken(user.user_id) ?? process.env.GITHUB_TOKEN ?? null;
      // Refresh a bounded batch to avoid exhausting the user's GitHub API quota.
      const targets = rows.slice(0, 20).filter((row) => token || row.visibility === "public");
      attempted = targets.length;
      const results = await mapLimit(targets, 5, async (row) => {
        const path = String(row.full_name).split("/").map(encodeURIComponent).join("/");
        try {
          const response = await fetch(`https://api.github.com/repos/${path}/contributors?per_page=100`, {
            headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            cache: "no-store", signal: AbortSignal.timeout(7000),
          });
          if (!response.ok) return false;
          const contributors = await response.json() as GithubContributor[];
          if (!Array.isArray(contributors)) return false;
          const normalized = contributors.filter((contributor) => typeof contributor.login === "string" && contributor.login.length > 0).map((contributor) => ({ login: contributor.login, avatar_url: contributor.avatar_url, contributions: Math.max(0, Number(contributor.contributions) || 0) }));
          const key = String(row.fullNameKey ?? row.full_name.toLowerCase()).toLowerCase();
          const checkedAt = new Date();
          await snapshotCollection.updateOne({ _id: key }, { $set: { "analytics.contributors": normalized, "analytics.contributorsCheckedAt": checkedAt, analyticsUpdatedAt: checkedAt } }, { upsert: true });
          const current = byName.get(key);
          byName.set(key, { ...current, analytics: { ...current?.analytics, contributors: normalized } });
          return true;
        } catch { return false; }
      });
      refreshed = results.filter(Boolean).length;
    }

    const nodes = new Map<string, MapNode>();
    const edges = new Map<string, MapEdge>();
    const repoTags = new Map<string, Set<string>>();
    const repoLanguages = new Map<string, Set<string>>();
    const contributorCoverage = { github: 0, sampled: 0, noData: 0 };
    const addNode = (node: MapNode) => {
      const current = nodes.get(node.id);
      nodes.set(node.id, current ? { ...current, value: current.value + node.value } : node);
    };
    const addEdge = (edge: MapEdge) => {
      const key = `${edge.type}:${edge.source}:${edge.target}`;
      const current = edges.get(key);
      edges.set(key, current ? { ...current, weight: current.weight + edge.weight } : edge);
    };

    for (const row of rows) {
      const fullName = String(row.full_name);
      const repoId = `repository:${fullName.toLowerCase()}`;
      addNode({ id: repoId, label: fullName, type: "repository", value: Math.max(1, Number(row.stars_count) || 0), url: `https://github.com/${fullName}` });
      const tags = new Set<string>((Array.isArray(row.topics) ? row.topics : []).map((tag: unknown) => String(tag).toLowerCase()).filter(Boolean));
      const languages = new Set<string>();
      const snapshot = byName.get(fullName.toLowerCase());
      const languageMap = snapshot?.languages && typeof snapshot.languages === "object" ? snapshot.languages : {};
      for (const [language, amount] of Object.entries(languageMap).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 4)) {
        if (!language || Number(amount) <= 0) continue;
        const id = `language:${language.toLowerCase()}`;
        languages.add(id);
        addNode({ id, label: language, type: "language", value: Number(amount) || 1 });
        addEdge({ source: repoId, target: id, type: "uses", weight: Number(amount) || 1 });
      }
      const primaryLanguage = String(row.primary_language || "").trim();
      if (!languages.size && primaryLanguage && primaryLanguage !== "Unknown") {
        const id = `language:${primaryLanguage.toLowerCase()}`;
        languages.add(id);
        addNode({ id, label: primaryLanguage, type: "language", value: 1 });
        addEdge({ source: repoId, target: id, type: "uses", weight: 1 });
      }
      repoTags.set(repoId, tags);
      repoLanguages.set(repoId, languages);
      for (const tag of tags) {
        const id = `topic:${tag}`;
        addNode({ id, label: tag, type: "topic", value: 1 });
        addEdge({ source: repoId, target: id, type: "tagged", weight: 1 });
      }

      const cachedContributors = snapshot?.analytics?.contributors;
      const contributorDataWasChecked = snapshot?.analytics?.contributorsCheckedAt instanceof Date;
      if (Array.isArray(cachedContributors) && (cachedContributors.length > 0 || contributorDataWasChecked)) {
        contributorCoverage.github++;
        for (const contributor of cachedContributors) {
          const login = String(contributor.login ?? "").trim();
          const count = Math.max(0, Number(contributor.contributions) || 0);
          if (!login || !count) continue;
          const id = `developer:${login.toLowerCase()}`;
          addNode({ id, label: login, type: "developer", value: count, url: `https://github.com/${encodeURIComponent(login)}` });
          addEdge({ source: id, target: repoId, type: "contributes", weight: count, evidence: "GitHub contributor data" });
        }
      } else {
        // Until GitHub contributor data is synced, use only commit authors and label the weight as sampled activity.
        const activity = snapshot?.recentActivity?.commits ?? [];
        const commitCounts = new Map<string, number>();
        for (const item of activity) {
          const author = item.author as { login?: string } | null | undefined;
          const login = String(author?.login ?? "").trim();
          if (login) commitCounts.set(login.toLowerCase(), (commitCounts.get(login.toLowerCase()) ?? 0) + 1);
        }
        if (commitCounts.size) contributorCoverage.sampled++;
        else contributorCoverage.noData++;
        for (const [login, count] of commitCounts) {
          const id = `developer:${login}`;
          addNode({ id, label: login, type: "developer", value: count, url: `https://github.com/${encodeURIComponent(login)}` });
          addEdge({ source: id, target: repoId, type: "contributes", weight: count, evidence: "Recent synced commits" });
        }
      }
    }

    const repoIds = [...repoTags.keys()];
    for (let i = 0; i < repoIds.length; i++) for (let j = i + 1; j < repoIds.length; j++) {
      const left = repoIds[i], right = repoIds[j];
      const shared = new Set([...(repoTags.get(left) ?? []), ...(repoLanguages.get(left) ?? [])]);
      const strength = [...new Set([...(repoTags.get(right) ?? []), ...(repoLanguages.get(right) ?? [])])].filter((value) => shared.has(value)).length;
      if (strength) addEdge({ source: left, target: right, type: "related", weight: strength });
    }

    totals.developers = [...nodes.values()].filter((node) => node.type === "developer").length;
    totals.languages = [...nodes.values()].filter((node) => node.type === "language").length;
    totals.topics = [...nodes.values()].filter((node) => node.type === "topic").length;
    const allNodes = [...nodes.values()].sort((a, b) => a.type.localeCompare(b.type) || b.value - a.value).slice(0, 180);
    const allowed = new Set(allNodes.map((node) => node.id));
    const allEdges = [...edges.values()].filter((edge) => allowed.has(edge.source) && allowed.has(edge.target)).slice(0, 500);
    return NextResponse.json({ nodes: allNodes, edges: allEdges, totals, viewer: user.login, updatedAt: new Date().toISOString(), contributorRefresh: { refreshed, attempted }, contributorCoverage });
  } catch (error) { return apiError(error); }
}
