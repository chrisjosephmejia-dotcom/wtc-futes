import type { Config, Context } from "@netlify/functions";
import { createHash, createHmac, createSign, randomBytes, timingSafeEqual } from "node:crypto";
import { extractOpenCalls } from "./lib/options-ledger.mjs";
import { buildCampaigns } from "./lib/options-campaigns.mjs";

const SHEET_SCOPE="https://www.googleapis.com/auth/spreadsheets.readonly";
const COOKIE="__Host-wtc-positions";
const SESSION_SECONDS=8*60*60;
const headers={"Cache-Control":"private, no-store, max-age=0","Pragma":"no-cache","Vary":"Cookie"};
const env=(key:string)=>Netlify.env.get(key)||"";
const json=(obj:unknown,status=200,extra:Record<string,string>={})=>Response.json(obj,{status,headers:{...headers,...extra}});
const b64=(v:Buffer|string)=>Buffer.from(v).toString("base64url");
const sha=(s:string)=>createHash("sha256").update(s).digest();
function match(a:string,b:string) {
  const x=sha(a),y=sha(b);
  return timingSafeEqual(x,y);
}
function secret() {
  const pass=env("WTC_POSITIONS_ACCESS_PASSWORD");
  if(pass.length<16) throw new Error("Position access password is not configured (minimum 16 characters).");
  return pass;
}
function cookieValue(pass:string) {
  const body=b64(JSON.stringify({exp:Date.now()+SESSION_SECONDS*1000,nonce:b64(randomBytes(16))}));
  const sig=b64(createHmac("sha256",pass).update(body).digest());
  return body+"."+sig;
}
function hasSession(request:Request,pass:string) {
  const raw=request.headers.get("cookie")||"";
  const m=raw.match(new RegExp("(?:^|;\\s*)"+COOKIE+"=([^;]+)"));
  if(!m)return false;
  const parts=m[1].split(".");
  if(parts.length!==2)return false;
  const expected=b64(createHmac("sha256",pass).update(parts[0]).digest());
  if(parts[1].length!==expected.length||!timingSafeEqual(Buffer.from(parts[1]),Buffer.from(expected)))return false;
  try{const payload=JSON.parse(Buffer.from(parts[0],"base64url").toString("utf8"));return Number.isFinite(payload.exp)&&payload.exp>Date.now();}catch{return false;}
}
const sessionCookie=(v:string,maxAge:number)=>`${COOKIE}=${v}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
let cachedToken:{token:string,expiresAt:number}|null=null;
async function googleAccessToken(){
  if(cachedToken && cachedToken.expiresAt>Date.now()+120_000)return cachedToken.token;
  const email=env("WTC_GOOGLE_CLIENT_EMAIL");
  const key=env("WTC_GOOGLE_PRIVATE_KEY").replace(/\\n/g,"\n");
  if(!email||!key)throw new Error("Google Sheets service account is not configured.");
  const now=Math.floor(Date.now()/1000);
  const hdr=b64(JSON.stringify({alg:"RS256",typ:"JWT"}));
  const claims=b64(JSON.stringify({iss:email,scope:SHEET_SCOPE,aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+3600}));
  const unsigned=hdr+"."+claims;
  const signed=b64(createSign("RSA-SHA256").update(unsigned).sign(key));
  const response=await fetch("https://oauth2.googleapis.com/token",{
    method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion:unsigned+"."+signed}),
    signal:AbortSignal.timeout(10000)
  });
  if(!response.ok)throw new Error("Google service-account authentication failed ("+response.status+").");
  const result:any=await response.json();
  if(!result.access_token||!Number.isFinite(Number(result.expires_in)))throw new Error("Google did not return a valid access token.");
  cachedToken={token:result.access_token,expiresAt:Date.now()+Number(result.expires_in)*1000};
  return cachedToken.token;
}
function centralDate(){
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const value=(type:string)=>parts.find(p=>p.type===type)?.value||"";
  return value("year")+"-"+value("month")+"-"+value("day");
}
async function getSheetPositions(){
  const id=env("WTC_OPTIONS_SHEET_ID");
  if(!id)throw new Error("WTC Options spreadsheet ID is not configured.");
  const token=await googleAccessToken();
  const uri=new URL("https://sheets.googleapis.com/v4/spreadsheets/"+encodeURIComponent(id)+"/values:batchGet");
  uri.searchParams.set("valueRenderOption","FORMATTED_VALUE");
  uri.searchParams.append("ranges","'Traditional IRA'!A1:T1000");
  uri.searchParams.append("ranges","'Audi Wheel'!A1:T1000");
  const response=await fetch(uri.toString(),{headers:{Authorization:"Bearer "+token},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error("Google Sheets read failed ("+response.status+"). Confirm Viewer sharing and sheet ID.");
  const result:any=await response.json();
  const ranges=result.valueRanges;
  if(!Array.isArray(ranges)||ranges.length!==2)throw new Error("Unexpected spreadsheet range response.");
  const today=centralDate();
  const spy=extractOpenCalls(ranges[0].values||[],"SPY","Traditional IRA",today);
  const qqq=extractOpenCalls(ranges[1].values||[],"QQQ","Audi Wheel",today);
  const spyCampaigns=buildCampaigns(ranges[0].values||[],"SPY","Traditional IRA");
  const qqqCampaigns=buildCampaigns(ranges[1].values||[],"QQQ","Audi Wheel");
  return {readAt:new Date().toISOString(),todayChicago:today,positions:{SPY:spy,QQQ:qqq},campaigns:{SPY:spyCampaigns,QQQ:qqqCampaigns},
    disclaimer:"Ledger-only positions. This is not a real-time brokerage reconciliation. Confirm same-day trades and available shares before opening or rolling calls."};
}
export default async (request:Request,_context:Context)=>{
  if(!["GET","POST"].includes(request.method))return json({error:"Method not allowed"},405,{"Allow":"GET, POST"});
  let pass:string;
  try{pass=secret();}catch{return json({error:"Position access is not configured"},503);}
  if(request.method==="POST"){
    const origin=request.headers.get("origin");
    if(!origin||origin!==new URL(request.url).origin)return json({error:"Same-origin request required"},403);
    let input:any;
    try{input=await request.json();}catch{return json({error:"Invalid JSON body"},400);}
    if(input?.action==="logout")return json({authenticated:false},200,{"Set-Cookie":sessionCookie("",0)});
    if(input?.action!=="login"||typeof input.password!=="string")return json({error:"Invalid login request"},400);
    if(!match(input.password,pass))return json({error:"Incorrect password"},401);
    return json({authenticated:true},200,{"Set-Cookie":sessionCookie(cookieValue(pass),SESSION_SECONDS)});
  }
  if(!hasSession(request,pass))return json({error:"Login required",authenticated:false},401);
  try{return json({authenticated:true,...await getSheetPositions()});}
  catch(error:any){
    // Never put credentials, tokens, or complete Google API responses in the payload.
    const message=String(error?.message||"Unknown error");
    const safe=/Google Sheets read failed|not configured|Unexpected spreadsheet|authentication failed/.test(message)?message:"Unable to read WTC Options right now.";
    return json({error:safe,authenticated:true},503);
  }
};
export const config:Config={path:"/api/positions",rateLimit:{action:"rate_limit",aggregateBy:"ip",windowSize:60,windowLimit:30}};
