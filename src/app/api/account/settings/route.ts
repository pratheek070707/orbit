import { NextRequest, NextResponse } from "next/server";
import { audit, requireUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { getMongoDatabase } from "@/lib/mongo";

type Preferences = { density: "comfortable" | "compact"; showActivity: boolean };
const defaults: Preferences = { density: "comfortable", showActivity: true };

export async function GET() {
  try {
    const user = await requireUser();
    const doc = await (await getMongoDatabase()).collection("orbit_preferences").findOne({ user_id: user.user_id });
    const saved = (doc?.preferences ?? {}) as Partial<Preferences>;
    return NextResponse.json({ preferences: { ...defaults, ...saved } });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = await request.json().catch(() => ({}));
    const updates: Partial<Preferences> = {};
    if (body.density !== undefined) {
      if (body.density !== "comfortable" && body.density !== "compact") return NextResponse.json({ error: "Choose comfortable or compact layout density." }, { status: 400 });
      updates.density = body.density;
    }
    if (body.showActivity !== undefined) {
      if (typeof body.showActivity !== "boolean") return NextResponse.json({ error: "Activity visibility must be on or off." }, { status: 400 });
      updates.showActivity = body.showActivity;
    }
    if (!Object.keys(updates).length) return NextResponse.json({ error: "Choose a setting to update." }, { status: 400 });
    const collection = (await getMongoDatabase()).collection("orbit_preferences");
    const current = await collection.findOne({ user_id: user.user_id });
    const preferences = { ...defaults, ...current?.preferences, ...updates } as Preferences;
    await collection.updateOne({ user_id: user.user_id }, { $set: { user_id: user.user_id, preferences, updated_at: new Date() } }, { upsert: true });
    await audit(user.user_id, "orbit.preferences_updated", "account", user.user_id, updates);
    return NextResponse.json({ preferences });
  } catch (error) { return apiError(error); }
}
