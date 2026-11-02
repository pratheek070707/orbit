import { NextRequest,NextResponse } from "next/server";
import { audit,requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { embedText,toPgVector } from "@/lib/embeddings";
import { apiError } from "@/lib/http";

type GitHubRepo={name:string;full_name:string;description:string|null;language:string|null;private:boolean;archived:boolean;stargazers_count:number;forks_count:number;open_issues_count:number;topics:string[];size:number};
async function github(path:string){
 const response=await fetch(`https://api.github.com${path}`,{headers:{Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28",...(process.env.GITHUB_TOKEN?{Authorization:`Bearer ${process.env.GITHUB_TOKEN}`}:{})},cache:"no-store",signal:AbortSignal.timeout(9000)});
 if(!response.ok){if(response.status===404)throw new Error("GitHub repository not found, or it is not publicly accessible.");if(response.status===403||response.status===429)throw new Error("GitHub API rate limit reached. Add a GitHub token in the environment and try again.");throw new Error(`GitHub returned status ${response.status}.`);}return response.json();
}
export async function POST(request:NextRequest){
 const client=await db.connect();
 try{
  const user=await requireUser();if(!["admin","developer","maintainer"].includes(user.role))throw new Error("FORBIDDEN");
  const supplied=String((await request.json()).fullName??"").trim();if(!/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(supplied))return NextResponse.json({error:"Enter a repository as owner/name."},{status:400});
  const [owner,name]=supplied.split("/");const repo=await github(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`) as GitHubRepo;
  if(repo.private)throw new Error("Only public repositories can be imported into this workspace.");
  if(repo.size>150000)return NextResponse.json({error:"This repository is too large to import in one request."},{status:413});
  const [commits,issues,pullRequests,languages,readme]=await Promise.all([
   github(`/repos/${repo.full_name}/commits?per_page=20`).catch(()=>[]),github(`/repos/${repo.full_name}/issues?state=open&per_page=20`).catch(()=>[]),
   github(`/repos/${repo.full_name}/pulls?state=all&per_page=20`).catch(()=>[]),github(`/repos/${repo.full_name}/languages`).catch(()=>({})),
   fetch(`https://api.github.com/repos/${repo.full_name}/readme`,{headers:{Accept:"application/vnd.github.raw+json","X-GitHub-Api-Version":"2022-11-28",...(process.env.GITHUB_TOKEN?{Authorization:`Bearer ${process.env.GITHUB_TOKEN}`}:{})},signal:AbortSignal.timeout(9000)}).then(r=>r.ok?r.text():"").catch(()=>"")
  ]);
  const language=repo.language??Object.entries(languages as Record<string,number>).sort((a,b)=>b[1]-a[1])[0]?.[0]??"Unknown";
  const embedding=toPgVector(embedText(`${repo.full_name} ${repo.description??""} ${language} ${repo.topics.join(" ")} ${readme.slice(0,12000)}`));
  await client.query("BEGIN");
  const saved=await client.query(`INSERT INTO repositories(owner_id,name,full_name,description,primary_language,visibility,is_archived,stars_count,forks_count,open_issues_count,topics,readme,summary_embedding,updated_at)
   VALUES($1,$2,$3,$4,$5,'public',$6,$7,$8,$9,$10,$11,$12::vector,NOW())
   ON CONFLICT(full_name) DO UPDATE SET description=EXCLUDED.description,primary_language=EXCLUDED.primary_language,is_archived=EXCLUDED.is_archived,stars_count=EXCLUDED.stars_count,forks_count=EXCLUDED.forks_count,open_issues_count=EXCLUDED.open_issues_count,topics=EXCLUDED.topics,readme=EXCLUDED.readme,summary_embedding=EXCLUDED.summary_embedding,updated_at=NOW()
   RETURNING repo_id`,[user.user_id,repo.name,repo.full_name,repo.description??"",language,repo.archived,repo.stargazers_count,repo.forks_count,repo.open_issues_count,repo.topics,readme.slice(0,20000),embedding]);
  const repoId=Number(saved.rows[0].repo_id);
  await client.query("INSERT INTO repository_members(repo_id,user_id,role) VALUES($1,$2,'admin') ON CONFLICT DO NOTHING",[repoId,user.user_id]);
  for(const item of commits as any[]){
   const login=String(item.author?.login??item.commit?.author?.name??"unknown").toLowerCase().replace(/[^a-z0-9-]/g,"").slice(0,60)||"unknown";
   const author=await client.query(`INSERT INTO users(login,full_name,email,password_hash,role,avatar_url) VALUES($1,$2,$3,'github-import-no-password','developer',$4) ON CONFLICT(login) DO UPDATE SET full_name=EXCLUDED.full_name,avatar_url=COALESCE(EXCLUDED.avatar_url,users.avatar_url) RETURNING user_id`,[login,String(item.commit?.author?.name??login).slice(0,160),`github-${login}@users.invalid`,item.author?.avatar_url??null]);
   const sha=String(item.sha??"").slice(0,64);if(!sha)continue;
   await client.query("INSERT INTO commits(repo_id,author_id,commit_hash,message,committed_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(commit_hash) DO UPDATE SET message=EXCLUDED.message",[repoId,Number(author.rows[0].user_id),sha,String(item.commit?.message??"Commit").slice(0,3000),item.commit?.author?.date??new Date().toISOString()]);
  }
  for(const issue of issues as any[]){if(issue.pull_request)continue;await client.query("INSERT INTO issues(repo_id,reporter_id,title,issue_type,status,github_number,created_at) VALUES($1,$2,$3,'question','open',$4,$5) ON CONFLICT(repo_id,github_number) DO UPDATE SET title=EXCLUDED.title,status='open'",[repoId,user.user_id,String(issue.title??"Untitled issue").slice(0,240),issue.number,issue.created_at??new Date().toISOString()]);}
  for(const pr of pullRequests as any[]){const status=pr.merged_at?"merged":pr.state==="closed"?"closed":"open";await client.query("INSERT INTO pull_requests(repo_id,author_id,title,status,github_number,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(repo_id,github_number) DO UPDATE SET title=EXCLUDED.title,status=EXCLUDED.status",[repoId,user.user_id,String(pr.title??"Untitled pull request").slice(0,240),status,pr.number,pr.created_at??new Date().toISOString()]);}
  if(readme){const fileEmbedding=toPgVector(embedText(`README.md ${readme.slice(0,12000)}`));await client.query("INSERT INTO repository_files(repo_id,file_path,file_type,size_bytes,content_excerpt,content_embedding) VALUES($1,'README.md','markdown',$2,$3,$4::vector) ON CONFLICT(repo_id,file_path) DO UPDATE SET content_excerpt=EXCLUDED.content_excerpt,size_bytes=EXCLUDED.size_bytes,content_embedding=EXCLUDED.content_embedding,updated_at=NOW()",[repoId,Buffer.byteLength(readme),readme.slice(0,12000),fileEmbedding]);}
  await client.query("COMMIT");await audit(user.user_id,"github.repository_imported","repository",repoId,{full_name:repo.full_name});
  return NextResponse.json({repoId,fullName:repo.full_name,imported:{commits:(commits as unknown[]).length,issues:(issues as unknown[]).filter((x:any)=>!x.pull_request).length,pullRequests:(pullRequests as unknown[]).length,files:readme?1:0}},{status:201});
 }catch(error){try{await client.query("ROLLBACK");}catch{}return apiError(error);}finally{client.release();}
}
