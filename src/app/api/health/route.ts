import { NextResponse } from "next/server";
import { getMongoDatabase } from "@/lib/mongo";

export const dynamic = "force-dynamic";

type Check = { status: "ready" | "needs-setup" | "offline"; message: string };

export async function GET() {
  const mongo: Check = await getMongoDatabase().then(async (database) => {
    await database.command({ ping: 1 });
    return { status: "ready", message: "Connected" } as const;
  }).catch(() => ({ status: process.env.MONGODB_URI ? "offline" : "needs-setup", message: process.env.MONGODB_URI ? "MongoDB is not reachable. Check the URI, paused cluster, and Atlas network access list." : "Add MONGODB_URI to .env." } as const));
  return NextResponse.json({
    status: mongo.status === "ready" ? "ready" : "setup-required",
    services: {
      accountStore: mongo,
      repositoryStore: mongo,
      githubOAuth: { status: process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET ? "ready" : "needs-setup", message: process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET ? "Configured" : "Add GitHub OAuth app credentials to .env." },
      googleOAuth: { status: process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? "ready" : "needs-setup", message: process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? "Configured" : "Optional: add Google OAuth credentials to enable Google sign-in." },
      ai: { status: process.env.AI_API_KEY ? "ready" : "needs-setup", message: process.env.AI_API_KEY ? `Configured with ${process.env.AI_MODEL || "gpt-6-luna"}.` : `Add AI_API_KEY for generated answers; model default is ${process.env.AI_MODEL || "gpt-6-luna"}.` },
    },
    checkedAt: new Date().toISOString(),
  });
}
