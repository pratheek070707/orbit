import { compare } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { COOKIE, signSession } from "@/lib/auth";
import { apiError } from "@/lib/http";

export async function POST(request:NextRequest){
  try{
    const body=await request.json();
    const email=String(body.email??"").trim().toLowerCase().slice(0,254);
    const password=String(body.password??"").slice(0,200);
    if(!email||!password)return NextResponse.json({error:"Enter your email and password."},{status:400});
    const result=await db.query("SELECT user_id,login,full_name,email,password_hash,role,avatar_url,status FROM users WHERE lower(email)=lower($1)",[email]);
    const row=result.rows[0];
    if(!row||row.status!=="active"||!(await compare(password,row.password_hash)))return NextResponse.json({error:"Email or password is incorrect."},{status:401});
    const user={user_id:Number(row.user_id),login:row.login,full_name:row.full_name,email:row.email,role:row.role,avatar_url:row.avatar_url};
    const response=NextResponse.json({user});
    response.cookies.set(COOKIE,signSession(user),{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:60*60*12});
    return response;
  }catch(error){return apiError(error);}
}
