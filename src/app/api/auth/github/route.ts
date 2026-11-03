import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { COOKIE, verifySession } from "@/lib/auth";
import { githubCallbackUrl } from "@/lib/github-auth";

export async function GET(request: NextRequest) {
  const appUrl = process.env.APP_URL ?? "http://localhost:3002";
  const isExplicitLink = request.nextUrl.searchParams.get("link") === "1";
  const orbitUser = verifySession(request.cookies.get(COOKIE)?.value);
  if (isExplicitLink && !orbitUser) return NextResponse.redirect(new URL("/?authError=github_link_session", appUrl));
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId || !process.env.GITHUB_CLIENT_SECRET) {
    return NextResponse.redirect(new URL("/?authError=github_not_configured", appUrl));
  }
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", githubCallbackUrl());
  authorize.searchParams.set("scope", "read:user user:email repo read:org delete_repo");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  const response = NextResponse.redirect(authorize);
  const secure = process.env.NODE_ENV === "production";
  response.cookies.set("orbit_github_state", state, { httpOnly: true, secure, sameSite: "lax", path: "/api/auth/github/callback", maxAge: 600 });
  response.cookies.set("orbit_github_verifier", verifier, { httpOnly: true, secure, sameSite: "lax", path: "/api/auth/github/callback", maxAge: 600 });
  response.cookies.set("orbit_github_link", isExplicitLink ? "1" : "", { httpOnly: true, secure, sameSite: "lax", path: "/api/auth/github/callback", maxAge: isExplicitLink ? 600 : 0 });
  return response;
}
