import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { projectsCollection, repositoriesCollection, repositoryWorkspaceFilter } from "@/lib/mongo";

export async function GET() {
  try {
    const user = await requireUser();
    const projects = await (await projectsCollection()).find({ owner_id: user.user_id }).sort({ updated_at: -1 }).limit(100).toArray();
    return NextResponse.json({ projects });
  } catch (error) { return apiError(error); }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = await request.json() as Record<string, unknown>;
    const name = String(body.name ?? "").trim();
    const description = String(body.description ?? "").trim();
    if (name.length < 2 || name.length > 80) return NextResponse.json({ error: "Project name must be 2–80 characters." }, { status: 400 });
    if (description.length > 500) return NextResponse.json({ error: "Project description must be 500 characters or fewer." }, { status: 400 });
    const requestedRepositories = [...new Set((Array.isArray(body.repositories) ? body.repositories : []).filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))].slice(0, 20);
    const repositoryRows = requestedRepositories.length
      ? await (await repositoriesCollection()).find({ fullNameKey: { $in: requestedRepositories.map((name) => name.toLowerCase()) }, ...repositoryWorkspaceFilter(user) }, { projection: { full_name: 1 } }).toArray()
      : [];
    if (repositoryRows.length !== requestedRepositories.length) return NextResponse.json({ error: "One or more selected repositories are unavailable in this Orbit workspace. Sync them and try again." }, { status: 400 });
    const project = { project_id: randomUUID(), owner_id: user.user_id, name, description, repositories: repositoryRows.map((row) => String(row.full_name)), items: [], created_at: new Date(), updated_at: new Date() };
    await (await projectsCollection()).insertOne(project);
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) { return apiError(error); }
}
