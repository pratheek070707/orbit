import { randomInt } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { COOKIE, signSession } from "@/lib/auth";
import { googleAccountsCollection, usersCollection } from "@/lib/mongo";

const home = (request: NextRequest, error?: string, state?: string) => {
  const target = new URL("/", request.url);
  if (error) target.searchParams.set("authError", error);
  const response = NextResponse.redirect(target);
  if (state && /^[A-Za-z0-9_-]{20,100}$/.test(state)) {
    response.cookies.set(`orbit_google_state_${state}`, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/auth/google/callback", maxAge: 0 });
  }
  return response;
};
const callback = () => `${(process.env.APP_URL ?? "http://localhost:3002").replace(/\/$/, "")}/api/auth/google/callback`;

export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  if (request.nextUrl.searchParams.has("error")) return home(request, "google_cancelled", state ?? undefined);
  const stateCookie = state && /^[A-Za-z0-9_-]{20,100}$/.test(state) ? request.cookies.get(`orbit_google_state_${state}`)?.value : undefined;
  if (!state || state !== stateCookie || !code) return home(request, "google_state", state ?? undefined);
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return home(request, "google_not_configured");
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: callback(), grant_type: "authorization_code" }),
      cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    const token = await tokenResponse.json() as { access_token?: string };
    if (!tokenResponse.ok || !token.access_token) return home(request, "google_token");
    const profileResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${token.access_token}` }, cache: "no-store", signal: AbortSignal.timeout(10000) });
    const profile = await profileResponse.json() as { sub?: string; email?: string; email_verified?: boolean; name?: string; picture?: string };
    if (!profileResponse.ok || !profile.sub || !profile.email || !profile.email_verified) return home(request, "google_profile");
    const users = await googleAccountsCollection();
    const existing = await users.findOne({ google_id: profile.sub });
    const githubUsers = await usersCollection();
    // Google creates or resumes an Orbit identity only. Similar email addresses
    // do not prove that two accounts belong to the same person; GitHub is linked
    // only after the user explicitly connects it from inside Orbit.
    let userId = existing?.user_id ?? -randomInt(1, 2_000_000_000);
    const googleProfile = { user_id: userId, login: profile.email.split("@")[0], full_name: profile.name ?? profile.email.split("@")[0], email: profile.email, avatar_url: profile.picture ?? null, auth_provider: "google", updated_at: new Date() };
    if (existing) {
      await users.updateOne({ google_id: profile.sub }, { $set: googleProfile });
    } else {
      while (await githubUsers.findOne({ user_id: userId }, { projection: { user_id: 1 } })) {
        userId = -randomInt(1, 2_000_000_000);
        googleProfile.user_id = userId;
      }
      await users.insertOne({ ...googleProfile, google_id: profile.sub, role: "developer", pinned_repo_ids: [], created_at: new Date() });
    }
    const currentOrbitUser = await githubUsers.findOne({ user_id: userId });
    if (!currentOrbitUser) {
      await githubUsers.insertOne({ ...googleProfile, role: "developer", pinned_repo_ids: [], created_at: new Date() });
    } else if (!currentOrbitUser.github_access_token) {
      await githubUsers.updateOne({ user_id: userId }, { $set: { login: googleProfile.login, full_name: googleProfile.full_name, email: googleProfile.email, avatar_url: googleProfile.avatar_url, auth_provider: "google", updated_at: new Date() } });
    }
    const row = await githubUsers.findOne({ user_id: userId });
    if (!row) throw new Error("MongoDB did not return the Google account.");
    const response = home(request, undefined, state);
    response.cookies.set(COOKIE, signSession({ user_id: row.user_id, login: row.login, full_name: row.full_name, email: row.email, role: row.role, avatar_url: row.avatar_url, github_connected: Boolean(row.github_access_token) }), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 12 });
    return response;
  } catch (error) {
    console.error("Google OAuth callback failed", error);
    return home(request, "google_failed");
  }
}
