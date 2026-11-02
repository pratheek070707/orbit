import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";

export async function GET(){
  try{
    const user=await requireUser();
    const visibility=user.role==="admin"||user.role==="maintainer"?"TRUE":"(r.visibility='public' OR r.owner_id=$1 OR EXISTS(SELECT 1 FROM repository_members m WHERE m.repo_id=r.repo_id AND m.user_id=$1))";
    const params=user.role==="admin"||user.role==="maintainer"?[]:[user.user_id];
    const [stats,languages,activity,contributors]=await Promise.all([
      db.query(`SELECT COUNT(*)::int repositories,COALESCE(SUM(r.stars_count),0)::int stars,(SELECT COUNT(*)::int FROM commits c JOIN repositories cr USING(repo_id) WHERE ${visibility.replaceAll("r.","cr.").replace("m.repo_id=cr.repo_id","m.repo_id=cr.repo_id")}) commits,(SELECT COUNT(DISTINCT c.author_id)::int FROM commits c JOIN repositories cr USING(repo_id) WHERE c.committed_at>NOW()-INTERVAL '7 days' AND ${visibility.replaceAll("r.","cr.").replaceAll("m.repo_id=r.repo_id","m.repo_id=cr.repo_id")}) contributors FROM repositories r WHERE ${visibility}`,params),
      db.query(`SELECT r.primary_language language,COUNT(*)::int count,ROUND(COUNT(*)*100.0/NULLIF(SUM(COUNT(*)) OVER(),0))::int percentage FROM repositories r WHERE ${visibility} GROUP BY r.primary_language ORDER BY count DESC`,params),
      db.query(`SELECT d::date day,TO_CHAR(d,'Mon DD') label,COALESCE(COUNT(c.commit_id),0)::int commits FROM generate_series(CURRENT_DATE-13,CURRENT_DATE,INTERVAL '1 day') d LEFT JOIN commits c ON c.committed_at::date=d::date AND EXISTS(SELECT 1 FROM repositories cr WHERE cr.repo_id=c.repo_id AND ${visibility.replaceAll("r.","cr.")}) GROUP BY d ORDER BY d`,params),
      db.query(`SELECT u.login,u.full_name,u.avatar_url,u.role,COUNT(c.commit_id)::int commits FROM commits c JOIN users u ON u.user_id=c.author_id JOIN repositories r ON r.repo_id=c.repo_id WHERE c.committed_at>NOW()-INTERVAL '7 days' AND ${visibility} GROUP BY u.user_id ORDER BY commits DESC LIMIT 6`,params),
    ]);
    return NextResponse.json({stats:{...stats.rows[0],stars_change:18},languages:languages.rows,activity:activity.rows,contributors:contributors.rows});
  }catch(error){return apiError(error);}
}
