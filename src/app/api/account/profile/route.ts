import { NextRequest, NextResponse } from "next/server";
import { audit, requireUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { getGithubToken, getMongoDatabase } from "@/lib/mongo";

const profileFields = ["displayName", "bio", "company", "location", "website"] as const;
type Profile = Record<(typeof profileFields)[number], string>;
const emptyProfile: Profile = { displayName: "", bio: "", company: "", location: "", website: "" };

export async function GET() {
  try {
    const user = await requireUser();
    const db = await getMongoDatabase();
    const profileDoc = await db.collection("orbit_profiles").findOne({ user_id: user.user_id });
    let githubProfile: Record<string, unknown> | null = null;
    const token = await getGithubToken(user.user_id);
    if (token) {
      const response = await fetch("https://api.github.com/user", { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" }, cache: "no-store", signal: AbortSignal.timeout(8000) }).catch(() => null);
      if (response?.ok) githubProfile = await response.json() as Record<string, unknown>;
    }
    return NextResponse.json({ githubProfile, orbitProfile: profileDoc?.profile ?? null });
  } catch (error) { return apiError(error); }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = await request.json().catch(() => ({}));
    const profile = { ...emptyProfile } as Profile;
    for (const field of profileFields) profile[field] = String(body[field] ?? "").trim();
    if (profile.displayName.length > 80 || profile.bio.length > 280 || profile.company.length > 100 || profile.location.length > 100 || profile.website.length > 200) return NextResponse.json({ error: "One or more profile fields are too long." }, { status: 400 });
    if (profile.website) {
      const website = /^https?:\/\//i.test(profile.website) ? profile.website : `https://${profile.website}`;
      try { const url = new URL(website); if (!["http:", "https:"].includes(url.protocol)) throw new Error(); profile.website = url.toString(); }
      catch { return NextResponse.json({ error: "Enter a valid website address." }, { status: 400 }); }
    }
    const collection = (await getMongoDatabase()).collection("orbit_profiles");
    await collection.updateOne({ user_id: user.user_id }, { $set: { user_id: user.user_id, profile, updated_at: new Date() } }, { upsert: true });
    await audit(user.user_id, "orbit.profile_updated", "account", user.user_id, { fields: profileFields });
    return NextResponse.json({ profile });
  } catch (error) { return apiError(error); }
}
