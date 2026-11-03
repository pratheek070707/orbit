import { NextRequest, NextResponse } from "next/server";
import { orbitAccountsCollection, usersCollection } from "@/lib/mongo";
import { COOKIE, signSession, verifySession } from "@/lib/auth";
import { encryptGithubToken, githubCallbackUrl } from "@/lib/github-auth";

const home = (_request: NextRequest, error?: string) => {
  const target = new URL("/", process.env.APP_URL ?? "http://localhost:3002");
  if (error) target.searchParams.set("authError", error);
  return NextResponse.redirect(target);
};

export async function GET(request: NextRequest) {
  const jar = request.cookies;
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const verifier = jar.get("orbit_github_verifier")?.value;
  if (request.nextUrl.searchParams.has("error")) return home(request, "github_cancelled");
  if (!state || state !== jar.get("orbit_github_state")?.value || !code || !verifier) return home(request, "github_state");
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) return home(request, "github_not_configured");

  try {
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: githubCallbackUrl(), code_verifier: verifier }),
      cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    const tokenResult = await tokenResponse.json() as { access_token?: string; error?: string };
    if (!tokenResponse.ok || !tokenResult.access_token) return home(request, "github_token");
    const accessToken = tokenResult.access_token;
    const headers = { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    const [profileResponse, emailResponse] = await Promise.all([
      fetch("https://api.github.com/user", { headers, cache: "no-store", signal: AbortSignal.timeout(10000) }),
      fetch("https://api.github.com/user/emails", { headers, cache: "no-store", signal: AbortSignal.timeout(10000) }),
    ]);
    if (!profileResponse.ok || !emailResponse.ok) return home(request, "github_profile");
    const profile = await profileResponse.json() as { id: number; login: string; name?: string | null; email?: string | null; avatar_url?: string };
    const emailRows = await emailResponse.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
    const email = emailRows.find((entry) => entry.primary && entry.verified)?.email ?? emailRows.find((entry) => entry.verified)?.email ?? `github-${profile.id}@users.invalid`;
    const fullName = (profile.name || profile.login).slice(0, 160);
    const encryptedToken = encryptGithubToken(accessToken);
    const collection = await usersCollection();
    const wantsLink = jar.get("orbit_github_link")?.value === "1";
    const currentUser = wantsLink ? verifySession(jar.get(COOKIE)?.value) : null;
    if (wantsLink && !currentUser) return home(request, "github_link_session");
    if (currentUser) {
      await collection.updateOne({ user_id: currentUser.user_id }, {
        $set: { github_id: profile.id, github_login: profile.login, github_full_name: fullName, github_email: email, github_avatar_url: profile.avatar_url ?? null, login: profile.login, full_name: fullName, email, avatar_url: profile.avatar_url ?? null, github_access_token: encryptedToken, github_connected: true, updated_at: new Date() },
        $setOnInsert: { user_id: currentUser.user_id, role: currentUser.role || "developer", auth_provider: "github", pinned_repo_ids: [], created_at: new Date() },
      }, { upsert: true });
      // Keep the Orbit credential record tied to this explicit GitHub identity.
      // The encrypted OAuth token lives only in the users collection.
      await (await orbitAccountsCollection()).updateOne({ user_id: currentUser.user_id }, { $set: { github_id: profile.id, github_login: profile.login, github_full_name: fullName, github_email: email, github_avatar_url: profile.avatar_url ?? null, github_connected: true, updated_at: new Date() } });
    } else {
      const previousLogin = await collection.find({ github_id: profile.id }).sort({ updated_at: -1 }).limit(1).next();
      if (previousLogin) {
        await collection.updateOne({ user_id: previousLogin.user_id }, { $set: { github_login: profile.login, github_full_name: fullName, github_email: email, login: profile.login, full_name: fullName, email, avatar_url: profile.avatar_url ?? null, github_access_token: encryptedToken, github_connected: true, updated_at: new Date() } });
      } else {
        await collection.updateOne({ github_id: profile.id }, {
          $set: { github_login: profile.login, github_full_name: fullName, github_email: email, login: profile.login, full_name: fullName, email, avatar_url: profile.avatar_url ?? null, github_access_token: encryptedToken, github_connected: true, updated_at: new Date() },
          $setOnInsert: { user_id: profile.id, github_id: profile.id, role: "developer", pinned_repo_ids: [], created_at: new Date() },
        }, { upsert: true });
      }
    }
    const row = currentUser
      ? await collection.findOne({ user_id: currentUser.user_id })
      : await collection.find({ github_id: profile.id }).sort({ updated_at: -1 }).limit(1).next();
    if (!row) throw new Error("MongoDB did not return the saved Orbit account.");
    const user = { user_id: row.user_id, login: row.github_login ?? row.login, full_name: row.github_full_name ?? row.full_name, email: row.github_email ?? row.email, role: row.role, avatar_url: row.github_avatar_url ?? row.avatar_url, github_connected: true };

    const response = home(request);
    response.cookies.set(COOKIE, signSession(user), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 12 });
    response.cookies.set("orbit_github_state", "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/auth/github/callback", maxAge: 0 });
    response.cookies.set("orbit_github_verifier", "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/auth/github/callback", maxAge: 0 });
    response.cookies.set("orbit_github_link", "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/auth/github/callback", maxAge: 0 });
    return response;
  } catch (error) {
    console.error("GitHub OAuth callback failed", error);
    return home(request, "github_failed");
  }
}
