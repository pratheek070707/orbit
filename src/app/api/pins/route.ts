import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { usersCollection } from "@/lib/mongo";

type PinnedEntity = { type: "organization" | "project"; id: string; label: string };
export async function GET() {
  try {
    const user = await requireUser();
    const account = await (await usersCollection()).findOne({ user_id: user.user_id }, { projection: { pinned_entities: 1 } });
    return NextResponse.json({ entities: (account?.pinned_entities ?? []) as PinnedEntity[] });
  } catch (error) { return apiError(error); }
}
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = await request.json() as Record<string, unknown>;
    const type = body.type;
    const id = String(body.id ?? "").trim();
    const label = String(body.label ?? id).trim().slice(0, 120);
    const pinned = body.pinned;
    if ((type !== "organization" && type !== "project") || typeof pinned !== "boolean") return NextResponse.json({ error: "Choose an organization or project and a pin action." }, { status: 400 });
    if ((type === "organization" && !/^[A-Za-z0-9-]{1,39}$/.test(id)) || (type === "project" && !(/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(id) || /^[0-9a-f-]{36}$/i.test(id)))) return NextResponse.json({ error: "Enter a valid organization or project name." }, { status: 400 });
    const collection = await usersCollection();
    const entity: PinnedEntity = { type, id, label: label || id };
    const existing = await collection.findOne({ user_id: user.user_id }, { projection: { pinned_entities: 1 } });
    if (!existing) return NextResponse.json({ error: "Connect GitHub to save pinned organizations and projects." }, { status: 409 });
    const current = (existing.pinned_entities ?? []) as PinnedEntity[];
    const entities = pinned
      ? [...current.filter((item) => item.type !== type || item.id !== id), entity]
      : current.filter((item) => item.type !== type || item.id !== id);
    await collection.updateOne({ user_id: user.user_id }, { $set: { pinned_entities: entities } });
    const account = await collection.findOne({ user_id: user.user_id }, { projection: { pinned_entities: 1 } });
    return NextResponse.json({ pinned, entities: (account?.pinned_entities ?? []) as PinnedEntity[] });
  } catch (error) { return apiError(error); }
}
