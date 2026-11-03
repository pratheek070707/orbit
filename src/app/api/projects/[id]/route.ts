import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { projectsCollection, repositoriesCollection, repositoryWorkspaceFilter } from "@/lib/mongo";

type Context = { params: Promise<{ id: string }> };
const projectId = async (context: Context) => (await context.params).id;

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const user = await requireUser();
    const id = await projectId(context);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    const collection = await projectsCollection();
    const project = await collection.findOne({ project_id: id, owner_id: user.user_id });
    if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "");
    if (action === "add_item") {
      const title = String(body.title ?? "").trim();
      const repository = String(body.repository ?? "").trim();
      if (title.length < 2 || title.length > 200) return NextResponse.json({ error: "Work item title must be 2–200 characters." }, { status: 400 });
      if (repository && !(await (await repositoriesCollection()).findOne({ fullNameKey: repository.toLowerCase(), ...repositoryWorkspaceFilter(user) }, { projection: { _id: 1 } }))) return NextResponse.json({ error: "Choose a repository available in this Orbit workspace." }, { status: 400 });
      const item = { item_id: randomUUID(), title, repository: repository || null, status: "todo" as const, created_at: new Date() };
      await collection.updateOne({ project_id: id, owner_id: user.user_id }, { $push: { items: item }, $set: { updated_at: new Date() } } as never);
      return NextResponse.json({ item }, { status: 201 });
    }
    if (action === "update_item") {
      const itemId = String(body.itemId ?? "");
      const value = String(body.status ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(itemId) || !["todo", "in_progress", "done"].includes(value)) return NextResponse.json({ error: "Choose a valid work item and status." }, { status: 400 });
      const status = value as "todo" | "in_progress" | "done";
      const result = await collection.updateOne({ project_id: id, owner_id: user.user_id, "items.item_id": itemId }, { $set: { "items.$.status": status, updated_at: new Date() } });
      if (!result.matchedCount) return NextResponse.json({ error: "Work item not found." }, { status: 404 });
      return NextResponse.json({ ok: true });
    }
    if (action === "remove_item") {
      const itemId = String(body.itemId ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(itemId)) return NextResponse.json({ error: "Choose a valid work item." }, { status: 400 });
      await collection.updateOne({ project_id: id, owner_id: user.user_id }, { $pull: { items: { item_id: itemId } }, $set: { updated_at: new Date() } } as never);
      return NextResponse.json({ ok: true });
    }
    if (action === "update_project") {
      const name = String(body.name ?? "").trim();
      const description = String(body.description ?? "").trim();
      if (name.length < 2 || name.length > 80 || description.length > 500) return NextResponse.json({ error: "Check the project name and description lengths." }, { status: 400 });
      await collection.updateOne({ project_id: id, owner_id: user.user_id }, { $set: { name, description, updated_at: new Date() } });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Choose a supported project action." }, { status: 400 });
  } catch (error) { return apiError(error); }
}

export async function DELETE(_request: NextRequest, context: Context) {
  try {
    const user = await requireUser();
    const id = await projectId(context);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    const result = await (await projectsCollection()).deleteOne({ project_id: id, owner_id: user.user_id });
    if (!result.deletedCount) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
