import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getGithubToken } from "@/lib/mongo";
import { apiError } from "@/lib/http";

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const token = await getGithubToken(user.user_id);
    if (!token) return NextResponse.json({ error: "Reconnect GitHub to comment on issues." }, { status: 401 });
    const body = await request.json();
    const repository = String(body.repository ?? "").trim();
    const number = Number(body.number);
    const comment = String(body.body ?? "").trim();
    if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !Number.isSafeInteger(number) || number < 1 || !comment || comment.length > 20000) return NextResponse.json({ error: "Enter a valid issue and a comment under 20,000 characters." }, { status: 400 });
    const response = await fetch(`https://api.github.com/repos/${repository}/issues/${number}/comments`, { method: "POST", headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" }, body: JSON.stringify({ body: comment }), cache: "no-store", signal: AbortSignal.timeout(12000) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return NextResponse.json({ error: typeof result.message === "string" ? result.message : "GitHub could not add this comment." }, { status: response.status });
    return NextResponse.json({ comment: result }, { status: 201 });
  } catch (error) { return apiError(error); }
}
