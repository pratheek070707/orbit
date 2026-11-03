import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { getMongoDatabase } from "@/lib/mongo";

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = await request.json() as Record<string, unknown>;
    const subject = String(body.subject ?? "").trim();
    const message = String(body.message ?? "").trim();
    const category = String(body.category ?? "other");
    if (subject.length < 4 || subject.length > 120) return NextResponse.json({ error: "Subject must be between 4 and 120 characters." }, { status: 400 });
    if (message.length < 10 || message.length > 5000) return NextResponse.json({ error: "Please provide 10 to 5,000 characters of detail." }, { status: 400 });
    if (!["account", "repositories", "issues", "ai", "other"].includes(category)) return NextResponse.json({ error: "Choose a support topic." }, { status: 400 });
    const ticketId = `ORB-${randomUUID().slice(0, 8).toUpperCase()}`;
    await (await getMongoDatabase()).collection("support_requests").insertOne({ ticket_id: ticketId, user_id: user.user_id, username: user.login, email: user.email, category, subject, message, status: "open", created_at: new Date() });
    return NextResponse.json({ ok: true, ticketId }, { status: 201 });
  } catch (error) { return apiError(error); }
}
