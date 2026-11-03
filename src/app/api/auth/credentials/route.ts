import { randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import { COOKIE, signSession } from "@/lib/auth";
import { orbitAccountsCollection, usersCollection } from "@/lib/mongo";

export const runtime = "nodejs";
const derive = promisify(scrypt) as (password: string, salt: string, keylen: number) => Promise<Buffer>;
const attempts = new Map<string, { count: number; until: number }>();

function setSession(response: NextResponse, user: { user_id: number; login: string; full_name: string; email: string; role: string; avatar_url: string | null; github_connected: boolean }) {
  response.cookies.set(COOKIE, signSession(user), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 12 });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const mode = body.mode === "register" ? "register" : "login";
    const username = String(body.username ?? "").trim();
    const key = username.toLowerCase();
    const password = String(body.password ?? "");
    const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const rateKey = `${address}:${key}`;
    const now = Date.now();
    const attempt = attempts.get(rateKey);
    if (attempt && attempt.until > now && attempt.count >= 12) return NextResponse.json({ error: "Too many sign-in attempts. Try again in 15 minutes." }, { status: 429 });
    if (attempts.size > 5000) for (const [savedKey, savedAttempt] of attempts) if (savedAttempt.until <= now) attempts.delete(savedKey);
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) return NextResponse.json({ error: "Username must be 3–32 letters, numbers, dots, dashes, or underscores." }, { status: 400 });
    if (password.length < 10 || password.length > 256) return NextResponse.json({ error: "Password must be between 10 and 256 characters." }, { status: 400 });

    const users = await orbitAccountsCollection();
    const account = await users.findOne({ username_key: key });
    if (mode === "register") {
      const email = String(body.email ?? "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
      if (account) return NextResponse.json({ error: "That username is already in use." }, { status: 409 });
      const salt = randomBytes(16).toString("hex");
      const passwordHash = (await derive(password, salt, 64)).toString("hex");
      let userId = -randomInt(1, 2_000_000_000);
      while (await users.findOne({ user_id: userId }, { projection: { user_id: 1 } })) userId = -randomInt(1, 2_000_000_000);
      const user = { user_id: userId, login: username, full_name: username, email, role: "developer", avatar_url: null, auth_provider: "password", username_key: key, password_salt: salt, password_hash: passwordHash, pinned_repo_ids: [], created_at: new Date() };
      await users.insertOne(user);
      const response = NextResponse.json({ ok: true, user: { login: username } }, { status: 201 });
      setSession(response, { user_id: user.user_id, login: user.login, full_name: user.full_name, email: user.email, role: user.role, avatar_url: user.avatar_url, github_connected: false });
      attempts.delete(rateKey);
      return response;
    }

    const valid = account?.password_hash && account.password_salt
      ? timingSafeEqual(Buffer.from(account.password_hash, "hex"), await derive(password, account.password_salt, 64))
      : false;
    if (!valid || !account) {
      const active = attempt?.until && attempt.until > now ? attempt : { count: 0, until: now + 15 * 60_000 };
      attempts.set(rateKey, { count: active.count + 1, until: active.until });
      return NextResponse.json({ error: "Incorrect username or password." }, { status: 401 });
    }
    attempts.delete(rateKey);
    const response = NextResponse.json({ ok: true, user: { login: account.login } });
    const linkedGithub = await (await usersCollection()).findOne({ user_id: account.user_id, github_access_token: { $type: "string", $ne: "" } });
    setSession(response, linkedGithub
      ? { user_id: account.user_id, login: linkedGithub.github_login ?? linkedGithub.login, full_name: linkedGithub.github_full_name ?? linkedGithub.full_name, email: linkedGithub.github_email ?? linkedGithub.email, role: linkedGithub.role ?? account.role, avatar_url: linkedGithub.github_avatar_url ?? linkedGithub.avatar_url, github_connected: true }
      : { user_id: account.user_id, login: account.login, full_name: account.full_name, email: account.email, role: account.role, avatar_url: account.avatar_url, github_connected: false });
    return response;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) return NextResponse.json({ error: "That username is already in use." }, { status: 409 });
    console.error("Orbit credential sign-in failed", error);
    return NextResponse.json({ error: "Orbit could not sign you in. Check the database connection and try again." }, { status: 500 });
  }
}
