import { NextRequest, NextResponse } from "next/server";
import { audit, requireUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { canReadRepository, getGithubToken, getRepositoryById, repositoriesCollection } from "@/lib/mongo";

type Context = { params: Promise<{ id: string }> };
type GitHubContent = { name: string; path: string; type: "file" | "dir" | "symlink" | "submodule"; size?: number; sha?: string; html_url?: string; encoding?: string; content?: string };
const validPath = (path: string) => path.length <= 800 && !path.includes("\\") && path.split("/").every((segment) => segment && segment !== "." && segment !== ".." && !/[\u0000-\u001f]/.test(segment));
const githubHeaders = (token: string) => ({ Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

async function writableRepository(id: number, user: Awaited<ReturnType<typeof requireUser>>) {
  const repository = await getRepositoryById(id);
  if (!repository || !(await canReadRepository(repository, user))) return { error: NextResponse.json({ error: "Repository not found." }, { status: 404 }) };
  const token = await getGithubToken(user.user_id);
  if (!token) return { error: NextResponse.json({ error: "Reconnect GitHub to commit file changes." }, { status: 401 }) };
  return { repository, token };
}

async function branchFor(fullName: string, token: string, requestedBranch: string) {
  const response = await fetch(`https://api.github.com/repos/${fullName}`, { headers: githubHeaders(token), cache: "no-store", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`GitHub could not load the repository (HTTP ${response.status}).`);
  const metadata = await response.json() as { default_branch?: string };
  const branch = requestedBranch || metadata.default_branch || "main";
  if (branch.length > 200 || branch.startsWith("-") || branch.includes("..") || /[\x00-\x20~^:?*[\\]/.test(branch)) throw new Error("Choose a valid branch name.");
  return branch;
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const user = await requireUser();
    const id = Number((await context.params).id);
    if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: "Repository not found." }, { status: 404 });
    const repository = await getRepositoryById(id);
    if (!repository || !(await canReadRepository(repository, user))) return NextResponse.json({ error: "Repository not found." }, { status: 404 });
    const token = await getGithubToken(user.user_id) ?? process.env.GITHUB_TOKEN;
    const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const fullName = String(repository.full_name);
    const base = `https://api.github.com/repos/${fullName}`;
    const metadataResponse = await fetch(base, { headers, cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!metadataResponse.ok) return NextResponse.json({ error: metadataResponse.status === 404 ? "GitHub could not find this repository or it is not accessible." : `GitHub returned HTTP ${metadataResponse.status} while loading repository files.` }, { status: metadataResponse.status });
    const metadata = await metadataResponse.json() as { default_branch: string };
    const branch = metadata.default_branch || "main";
    const rawPath = (request.nextUrl.searchParams.get("path") ?? "").trim();
    const requestedFile = (request.nextUrl.searchParams.get("file") ?? "").trim();
    if (rawPath && !validPath(rawPath) || requestedFile && !validPath(requestedFile)) return NextResponse.json({ error: "Invalid repository path." }, { status: 400 });
    const encodePath = (value: string) => value.split("/").map(encodeURIComponent).join("/");
    if (requestedFile) {
      const response = await fetch(`${base}/contents/${encodePath(requestedFile)}?ref=${encodeURIComponent(branch)}`, { headers, cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (!response.ok) return NextResponse.json({ error: response.status === 404 ? "File not found on the default branch." : `GitHub returned HTTP ${response.status} while loading this file.` }, { status: response.status });
      const file = await response.json() as GitHubContent;
      if (file.type !== "file") return NextResponse.json({ error: "Choose a file to preview." }, { status: 400 });
      if ((file.size ?? 0) > 512_000 || file.encoding !== "base64" || !file.content) return NextResponse.json({ error: "This file is larger than the 500 KB text preview limit." }, { status: 413 });
      const content = Buffer.from(file.content.replace(/\s/g, ""), "base64").toString("utf8");
      return NextResponse.json({ file: { name: file.name, path: file.path, size: file.size ?? 0 }, content, branch });
    }
    const path = rawPath ? `/${encodePath(rawPath)}` : "";
    const response = await fetch(`${base}/contents${path}?ref=${encodeURIComponent(branch)}`, { headers, cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!response.ok) return NextResponse.json({ error: response.status === 404 ? "Folder not found on the default branch." : `GitHub returned HTTP ${response.status} while loading repository files.` }, { status: response.status });
    const contents = await response.json() as GitHubContent[] | GitHubContent;
    const files = (Array.isArray(contents) ? contents : [contents]).map((item) => ({ name: item.name, path: item.path, type: item.type, size: item.size ?? 0, url: item.html_url ?? `https://github.com/${fullName}/tree/${encodeURIComponent(branch)}/${encodePath(item.path)}` })).slice(0, 300);
    return NextResponse.json({ repository: fullName, branch, path: rawPath, files, truncated: files.length >= 300 });
  } catch (error) { return apiError(error); }
}

export async function PUT(request: NextRequest, context: Context) {
  try {
    const user = await requireUser();
    const id = Number((await context.params).id);
    if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: "Repository not found." }, { status: 404 });
    const access = await writableRepository(id, user);
    if ("error" in access) return access.error;
    const body = await request.json();
    const path = String(body.path ?? "").trim();
    const content = String(body.content ?? "");
    const message = String(body.message ?? "").trim().slice(0, 300);
    if (!validPath(path) || Buffer.byteLength(content, "utf8") > 512_000 || !message) return NextResponse.json({ error: "Enter a valid path, a commit message, and text under 500 KB." }, { status: 400 });
    const branch = await branchFor(access.repository.full_name, access.token, String(body.branch ?? "").trim());
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const fileUrl = `https://api.github.com/repos/${access.repository.full_name}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
    const current = await fetch(fileUrl, { headers: githubHeaders(access.token), cache: "no-store", signal: AbortSignal.timeout(10000) });
    let sha: string | undefined;
    if (current.ok) {
      const metadata = await current.json() as { type?: string; sha?: string };
      if (metadata.type !== "file" || !metadata.sha) return NextResponse.json({ error: "Choose a regular file to update." }, { status: 400 });
      sha = metadata.sha;
    } else if (current.status !== 404) {
      const detail = await current.json().catch(() => ({})) as { message?: string };
      return NextResponse.json({ error: detail.message ?? `GitHub returned HTTP ${current.status} while checking the file.` }, { status: current.status });
    }
    const response = await fetch(`https://api.github.com/repos/${access.repository.full_name}/contents/${encodedPath}`, { method: "PUT", headers: githubHeaders(access.token), body: JSON.stringify({ message, content: Buffer.from(content, "utf8").toString("base64"), branch, ...(sha ? { sha } : {}) }), cache: "no-store", signal: AbortSignal.timeout(15000) });
    const result = await response.json().catch(() => ({})) as { content?: { path?: string; sha?: string; html_url?: string }; commit?: { sha?: string }; message?: string };
    if (!response.ok) return NextResponse.json({ error: result.message ?? `GitHub could not commit this file (HTTP ${response.status}).` }, { status: response.status });
    await (await repositoriesCollection()).updateOne({ repo_id: id }, { $set: { updated_at: new Date() } });
    await audit(user.user_id, sha ? "github.file_updated" : "github.file_created", "repository_file", id, { path, branch, commit: result.commit?.sha });
    return NextResponse.json({ file: result.content, commit: result.commit, branch, created: !sha }, { status: sha ? 200 : 201 });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const user = await requireUser();
    const id = Number((await context.params).id);
    if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: "Repository not found." }, { status: 404 });
    const access = await writableRepository(id, user);
    if ("error" in access) return access.error;
    const body = await request.json();
    const path = String(body.path ?? "").trim();
    const message = String(body.message ?? "").trim().slice(0, 300);
    if (!validPath(path) || !message) return NextResponse.json({ error: "Enter a valid file path and commit message." }, { status: 400 });
    const branch = await branchFor(access.repository.full_name, access.token, String(body.branch ?? "").trim());
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const fileUrl = `https://api.github.com/repos/${access.repository.full_name}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
    const current = await fetch(fileUrl, { headers: githubHeaders(access.token), cache: "no-store", signal: AbortSignal.timeout(10000) });
    const metadata = await current.json().catch(() => ({})) as { type?: string; sha?: string; message?: string };
    if (!current.ok || metadata.type !== "file" || !metadata.sha) return NextResponse.json({ error: metadata.message ?? "GitHub could not find that file on this branch." }, { status: current.ok ? 400 : current.status });
    const response = await fetch(`https://api.github.com/repos/${access.repository.full_name}/contents/${encodedPath}`, { method: "DELETE", headers: githubHeaders(access.token), body: JSON.stringify({ message, sha: metadata.sha, branch }), cache: "no-store", signal: AbortSignal.timeout(15000) });
    const result = await response.json().catch(() => ({})) as { commit?: { sha?: string }; message?: string };
    if (!response.ok) return NextResponse.json({ error: result.message ?? `GitHub could not delete this file (HTTP ${response.status}).` }, { status: response.status });
    await audit(user.user_id, "github.file_deleted", "repository_file", id, { path, branch, commit: result.commit?.sha });
    return NextResponse.json({ deleted: true, commit: result.commit, branch });
  } catch (error) { return apiError(error); }
}
