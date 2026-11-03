import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getGithubToken, repositorySnapshots, repositoriesCollection, repositoryWorkspaceFilter, saveGitHubRepository } from "@/lib/mongo";
import { audit } from "@/lib/auth";
import { apiError } from "@/lib/http";
const api=(token:string)=>({Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28",Authorization:`Bearer ${token}`});
async function failure(response:Response){const data=await response.json().catch(()=>({}));return NextResponse.json({error:typeof data.message==="string"?data.message:"GitHub could not complete the request."},{status:response.status});}
async function mapLimit<T,R>(values:T[],limit:number,operation:(value:T)=>Promise<R>):Promise<R[]>{const output=new Array<R>(values.length);let cursor=0;await Promise.all(Array.from({length:Math.min(limit,values.length)},async()=>{while(cursor<values.length){const index=cursor++;output[index]=await operation(values[index]);}}));return output;}
export async function GET(request:NextRequest){try{
  const user=await requireUser(),token=await getGithubToken(user.user_id);
  if(!token)return NextResponse.json({error:"Reconnect GitHub to access your repositories."},{status:401});
  const repositories:Record<string,unknown>[]=[];
  for(let page=1;page<=10;page++){
    const response=await fetch(`https://api.github.com/user/repos?affiliation=owner,collaborator,organization_member&sort=updated&direction=desc&per_page=100&page=${page}`,{headers:api(token),cache:"no-store",signal:AbortSignal.timeout(12000)});
    if(!response.ok)return failure(response);
    const rows=await response.json() as Record<string,unknown>[];
    repositories.push(...rows);
    if(rows.length<100)break;
  }
  let synced=0;
  if(request.nextUrl.searchParams.get("sync")==="1"){
    const enrich=new Set(repositories.slice(0,100).map(repo=>Number(repo.id)));
    await mapLimit(repositories,8,async repo=>{
      const fullName=String(repo.full_name??"");
      const shouldEnrich=enrich.has(Number(repo.id));
      const [languagesResponse,commitsResponse]=shouldEnrich?await Promise.all([
        fetch(`https://api.github.com/repos/${fullName}/languages`,{headers:api(token),cache:"no-store",signal:AbortSignal.timeout(10000)}).catch(()=>null),
        fetch(`https://api.github.com/repos/${fullName}/commits?per_page=30`,{headers:api(token),cache:"no-store",signal:AbortSignal.timeout(10000)}).catch(()=>null),
      ]):[null,null];
      const languages=languagesResponse?.ok?await languagesResponse.json() as Record<string,number>:{};
      const commits=commitsResponse?.ok?await commitsResponse.json() as unknown[]:[];
      await saveGitHubRepository(user.user_id,repo,{languages,commit_count:commits.length,recentActivity:{commits,issues:[],pullRequests:[]}});
      synced++;
    });
    await audit(user.user_id,"github.account_synced","account",user.user_id,{repositories:synced});
  }
  return NextResponse.json({repositories,synced,total:repositories.length,details_synced:request.nextUrl.searchParams.get("sync")==="1"?Math.min(100,repositories.length):0});
}catch(error){return apiError(error);}}
export async function POST(request:NextRequest){try{const user=await requireUser(),token=await getGithubToken(user.user_id);if(!token)return NextResponse.json({error:"Reconnect GitHub to create repositories."},{status:401});const body=await request.json(),name=String(body.name??"").trim(),description=String(body.description??"").trim(),owner=String(body.owner??"").trim();if(!/^[A-Za-z0-9_.-]{1,100}$/.test(name)||description.length>350||owner&&!/^[A-Za-z0-9-]{1,39}$/.test(owner))return NextResponse.json({error:"Check the repository name, description, and owner."},{status:400});const url=owner?`https://api.github.com/orgs/${encodeURIComponent(owner)}/repos`:"https://api.github.com/user/repos";const response=await fetch(url,{method:"POST",headers:{...api(token),"Content-Type":"application/json"},body:JSON.stringify({name,description,private:body.visibility==="private",auto_init:body.initialize!==false,has_issues:true,has_projects:true,has_wiki:true}),cache:"no-store",signal:AbortSignal.timeout(12000)});if(!response.ok)return failure(response);const repository=await response.json() as Record<string,unknown>;const saved=await saveGitHubRepository(user.user_id,repository);await audit(user.user_id,"github.repository_created","repository",saved.repo_id,{full_name:saved.full_name});return NextResponse.json({repository},{status:201});}catch(error){return apiError(error);}}

export async function DELETE(request:NextRequest){try{
  const user=await requireUser(),token=await getGithubToken(user.user_id);
  if(!token)return NextResponse.json({error:"Reconnect GitHub before deleting a repository."},{status:401});
  const body=await request.json().catch(()=>({})),fullName=String(body.fullName??"").trim(),confirmation=String(body.confirmFullName??"").trim();
  if(!/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/.test(fullName))return NextResponse.json({error:"Enter a valid owner/repository name."},{status:400});
  if(confirmation!==fullName)return NextResponse.json({error:"The confirmation must exactly match the repository name."},{status:400});
  const collection=await repositoriesCollection(),repo=await collection.findOne({fullNameKey:fullName.toLowerCase(),...repositoryWorkspaceFilter(user)});
  if(!repo)return NextResponse.json({error:"Sync this repository to Orbit before deleting it."},{status:404});
  const url=`https://api.github.com/repos/${fullName.split("/").map(encodeURIComponent).join("/")}`;
  const access=await fetch(url,{headers:api(token),cache:"no-store",signal:AbortSignal.timeout(12000)});
  if(!access.ok){const result=await access.json().catch(()=>({}));return NextResponse.json({error:String(result.message??"GitHub could not verify your access to this repository.")},{status:access.status});}
  const details=await access.json() as {permissions?:{admin?:boolean}};
  if(details.permissions?.admin!==true)return NextResponse.json({error:"GitHub only allows repository administrators to delete a repository. Ask an owner or administrator to do this."},{status:403});
  const response=await fetch(url,{method:"DELETE",headers:api(token),cache:"no-store",signal:AbortSignal.timeout(12000)});
  if(!response.ok){const result=await response.json().catch(()=>({}));const message=String(result.message??"GitHub could not delete this repository.");const scopes=response.headers.get("x-oauth-scopes")??"";const missingDeleteScope=!scopes.split(",").map(scope=>scope.trim()).includes("delete_repo");return NextResponse.json({error:response.status===403?`${message} ${missingDeleteScope?"Reconnect GitHub in Orbit Settings and authorize the delete_repo permission, then retry.":"Your GitHub account needs repository administration access."}`:message},{status:response.status});}
  await Promise.all([
    collection.deleteOne({repo_id:repo.repo_id}),
    (await repositorySnapshots()).deleteOne({_id:repo.fullNameKey}),
  ]);
  await audit(user.user_id,"github.repository_deleted","repository",repo.repo_id,{full_name:repo.full_name});
  return NextResponse.json({ok:true,fullName:repo.full_name});
}catch(error){return apiError(error);}}
