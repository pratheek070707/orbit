import { NextRequest, NextResponse } from "next/server";
import { audit, requireUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { canReadRepository, getRepositoryById, repositoriesCollection } from "@/lib/mongo";

type Context = { params: Promise<{ id: string }> };
export async function POST(request: NextRequest, context: Context) {
  try {
    const user = await requireUser();
    const id = Number((await context.params).id);
    if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: "Repository not found." }, { status: 404 });
    const repo = await getRepositoryById(id);
    if (!repo || !(await canReadRepository(repo, user))) return NextResponse.json({ error: "Repository not found." }, { status: 404 });
    const body = await request.json();
    if (typeof body.pinned !== "boolean") return NextResponse.json({ error: "Choose whether this repository should be pinned." }, { status: 400 });
    const pinnedBy = repo.pinned_by ?? [];
    const nextPinnedBy = body.pinned ? [...new Set([...pinnedBy, user.user_id])] : pinnedBy.filter((id) => id !== user.user_id);
    await (await repositoriesCollection()).updateOne({ repo_id: id }, { $set: { pinned_by: nextPinnedBy } });
    await audit(user.user_id, body.pinned ? "repository.pinned" : "repository.unpinned", "repository", id);
    return NextResponse.json({ pinned: body.pinned });
  } catch (error) { return apiError(error); }
}
