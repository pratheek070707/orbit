import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { repositoryWorkspaceFilter, repositoriesCollection, repositorySnapshots } from "@/lib/mongo";
import { apiError } from "@/lib/http";

export async function GET(){
 try{
  const user=await requireUser();
  const result=await (await repositoriesCollection()).find({...repositoryWorkspaceFilter(user),is_archived:false},{projection:{full_name:1,fullNameKey:1}}).limit(1000).toArray();
  const names=result.map(row=>String(row.fullNameKey??row.full_name.toLowerCase()));if(!names.length)return NextResponse.json({activity:[]});
  const documents=await (await repositorySnapshots()).find({_id:{$in:names}}).toArray();const events:Array<{type:string;repository:string;title:string;author:string;date:string;url:string;number?:number;state?:string}>=[];
  for(const doc of documents){const recent=doc.recentActivity??{};for(const item of recent.commits??[]){events.push({type:"commit",repository:doc.fullName,title:String(item.commit?.message??"Commit").split("\n")[0],author:String(item.author?.login??item.commit?.author?.name??"GitHub user"),date:String(item.commit?.author?.date??item.commit?.committer?.date??""),url:String(item.html_url??`https://github.com/${doc.fullName}/commits`)});}
   for(const item of recent.pullRequests??[]){events.push({type:"pull_request",repository:doc.fullName,title:String(item.title??"Pull request"),author:String(item.user?.login??"GitHub user"),date:String(item.created_at??""),url:String(item.html_url??`https://github.com/${doc.fullName}/pulls`),number:Number(item.number),state:item.merged_at?"merged":String(item.state??"open")});}
   for(const item of recent.issues??[]){events.push({type:"issue",repository:doc.fullName,title:String(item.title??"Issue"),author:String(item.user?.login??"GitHub user"),date:String(item.created_at??""),url:String(item.html_url??`https://github.com/${doc.fullName}/issues`),number:Number(item.number),state:String(item.state??"open")});}
  }
  events.sort((a,b)=>new Date(b.date).getTime()-new Date(a.date).getTime());return NextResponse.json({activity:events.slice(0,30)});
 }catch(error){return apiError(error);}
}
