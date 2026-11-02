import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
export type User={user_id:number;login:string;full_name:string;email:string;role:string;avatar_url:string|null};
export const COOKIE="mapper_session";
function secret(){if(!process.env.AUTH_SECRET)throw new Error("AUTH_SECRET must be set before signing sessions.");return process.env.AUTH_SECRET;}
export function signSession(user:User){const payload=Buffer.from(JSON.stringify({...user,exp:Date.now()+12*60*60*1000})).toString("base64url");return `${payload}.${createHmac("sha256",secret()).update(payload).digest("base64url")}`;}
export async function getCurrentUser():Promise<User|null>{
  const token=(await cookies()).get(COOKIE)?.value;if(!token)return null;
  const [payload,signature]=token.split(".");if(!payload||!signature)return null;
  const expected=createHmac("sha256",secret()).update(payload).digest(),supplied=Buffer.from(signature,"base64url");
  if(expected.length!==supplied.length||!timingSafeEqual(expected,supplied))return null;
  try{const user=JSON.parse(Buffer.from(payload,"base64url").toString()) as User&{exp:number};return user.exp>Date.now()?user:null;}catch{return null;}
}
export async function requireUser(){const user=await getCurrentUser();if(!user)throw new Error("UNAUTHORIZED");return user;}
export async function audit(actorId:number|null,eventType:string,entityType:string,entityId:number|null,details:object={}){await db.query("INSERT INTO audit_events(actor_id,event_type,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5)",[actorId,eventType,entityType,entityId,JSON.stringify(details)]);}
