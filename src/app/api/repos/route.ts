import { NextRequest,NextResponse } from "next/server";
import { audit,requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { embedText,toPgVector } from "@/lib/embeddings";
import { apiError } from "@/lib/http";

export async function GET(request:NextRequest){
  try{
    const user=await requireUser();const params=request.nextUrl.searchParams;
    const q=(params.get("q")??"").trim().slice(0,200);const mode=params.get("mode")==="semantic"?"semantic":"keyword";const filter=params.get("filter")??"All repositories";
    const clauses:string[]=[];const values:unknown[]=[];
    if(user.role!=="admin"&&user.role!=="maintainer"){values.push(user.user_id);clauses.push(`(r.visibility='public' OR r.owner_id=$${values.length} OR EXISTS(SELECT 1 FROM repository_members m WHERE m.repo_id=r.repo_id AND m.user_id=$${values.length}))`);}
    if(filter==="Public")clauses.push("r.visibility='public'");if(filter==="Private")clauses.push("r.visibility='private'");if(filter==="Archived")clauses.push("r.is_archived=TRUE");else clauses.push("r.is_archived=FALSE");
    let order="r.stars_count DESC";
    if(q&&mode==="keyword"){values.push(`%${q.replace(/[\\%_]/g,"\\$&")}%`);clauses.push(`(r.full_name ILIKE $${values.length} OR r.description ILIKE $${values.length} OR r.primary_language ILIKE $${values.length} OR array_to_string(r.topics,' ') ILIKE $${values.length})`);}
    if(q&&mode==="semantic"){values.push(toPgVector(embedText(q)));order=`r.summary_embedding <=> $${values.length}::vector`;}
    const where=clauses.length?`WHERE ${clauses.join(" AND ")}`:"";
    const result=await db.query(`SELECT r.repo_id,r.full_name,r.description,r.primary_language,r.visibility,r.is_archived,r.stars_count,r.forks_count,r.open_issues_count,r.topics,r.updated_at,u.full_name owner_name,(SELECT COUNT(*)::int FROM commits c WHERE c.repo_id=r.repo_id) commit_count${q&&mode==="semantic"?`,r.summary_embedding <=> $${values.length}::vector AS distance`:""} FROM repositories r JOIN users u ON u.user_id=r.owner_id ${where} ORDER BY ${order} LIMIT 50`,values);
    return NextResponse.json({repositories:result.rows,mode});
  }catch(error){return apiError(error);}
}

export async function POST(request:NextRequest){
  try{
    const user=await requireUser();if(!["admin","developer"].includes(user.role))throw new Error("FORBIDDEN");
    const body=await request.json();const name=String(body.name??"").trim();const description=String(body.description??"").trim();const language=String(body.language??"Unknown").trim();const visibility=body.visibility==="private"?"private":"public";
    if(!/^[a-zA-Z0-9_.-]{2,120}$/.test(name)||description.length>1000||language.length>60)return NextResponse.json({error:"Check the repository name, description, and language."},{status:400});
    const fullName=`${user.login}/${name}`;const embedding=toPgVector(embedText(`${fullName} ${description} ${language}`));
    const result=await db.query("INSERT INTO repositories(owner_id,name,full_name,description,primary_language,visibility,summary_embedding) VALUES($1,$2,$3,$4,$5,$6,$7::vector) RETURNING repo_id,full_name,description,primary_language,visibility,stars_count,forks_count,open_issues_count,topics,updated_at",[user.user_id,name,fullName,description,language,visibility,embedding]);
    await audit(user.user_id,"repository.created","repository",Number(result.rows[0].repo_id),{full_name:fullName});
    return NextResponse.json({repository:result.rows[0]},{status:201});
  }catch(error){return apiError(error);}
}
