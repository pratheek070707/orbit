import { NextRequest,NextResponse } from "next/server";
import { audit,requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { embedText,toPgVector } from "@/lib/embeddings";
import { apiError } from "@/lib/http";

export async function PATCH(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{
  const user=await requireUser(),{id}=await params,repoId=Number(id);if(!Number.isSafeInteger(repoId))return NextResponse.json({error:"Invalid repository id."},{status:400});
  const body=await request.json();const description=String(body.description??"").trim();if(description.length>1000)return NextResponse.json({error:"Description must be 1,000 characters or fewer."},{status:400});
  const visibility=body.visibility==="private"?"private":"public",archived=Boolean(body.is_archived);
  const allowed=await db.query("SELECT 1 FROM repositories r WHERE r.repo_id=$1 AND (r.owner_id=$2 OR EXISTS(SELECT 1 FROM repository_members m WHERE m.repo_id=r.repo_id AND m.user_id=$2 AND m.role IN ('admin','maintainer')))",[repoId,user.user_id]);
  if(!allowed.rowCount&&user.role!=="admin")throw new Error("FORBIDDEN");
  const current=await db.query("SELECT full_name,primary_language,topics,readme FROM repositories WHERE repo_id=$1",[repoId]);if(!current.rowCount)throw new Error("NOT_FOUND");
  const r=current.rows[0],embedding=toPgVector(embedText(`${r.full_name} ${description} ${r.primary_language} ${r.topics.join(" ")} ${r.readme}`));
  const result=await db.query("UPDATE repositories SET description=$1,visibility=$2,is_archived=$3,summary_embedding=$4::vector,updated_at=NOW() WHERE repo_id=$5 RETURNING repo_id,full_name,description,visibility,is_archived",[description,visibility,archived,embedding,repoId]);
  await audit(user.user_id,"repository.updated","repository",repoId,{visibility,is_archived:archived});return NextResponse.json({repository:result.rows[0]});
 }catch(error){return apiError(error);}
}
