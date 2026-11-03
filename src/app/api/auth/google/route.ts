import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

const callback = () => `${(process.env.APP_URL ?? "http://localhost:3002").replace(/\/$/, "")}/api/auth/google/callback`;

export async function GET(request: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) return NextResponse.redirect(new URL("/?authError=google_not_configured", request.url));
  const state = randomBytes(32).toString("base64url");
  const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", callback());
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", "openid email profile");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("prompt", "select_account");
  const response = NextResponse.redirect(authorize);
  // Keep each attempt's state in its own cookie. A single shared cookie gets
  // overwritten if the user retries or opens two Google sign-in tabs.
  response.cookies.set(`orbit_google_state_${state}`, state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/auth/google/callback", maxAge: 600 });
  return response;
}
