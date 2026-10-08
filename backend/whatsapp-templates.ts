import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Meta requires server-side App Secret Proof for this app's Graph requests.
async function metaFetch(input:string,options:RequestInit={}){
 const url=new URL(input),authorization=new Headers(options.headers).get("Authorization")||"";
 const token=authorization.replace(/^Bearer\s+/i,""),secret=Deno.env.get("WHATSAPP_APP_SECRET")||Deno.env.get("META_APP_SECRET");
 if(url.hostname==="graph.facebook.com"&&token&&secret){
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const proof=[...new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(token)))].map(x=>x.toString(16).padStart(2,"0")).join("");
  url.searchParams.set("appsecret_proof",proof);
 }
 return fetch(url.toString(),options);
}
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const WABA="922433197569331", API="v23.0";
const defs:any={
 fsp_new_enquiry_received:{category:"UTILITY",language:"ta",components:[{type:"BODY",text:"வணக்கம் {{1}},\nFuture Secure Providers-க்கு உங்கள் Insurance enquiry கிடைத்துள்ளது.\nஉங்கள் தேவையைப் புரிந்துகொண்டு தேவையான தகவல்களுடன் விரைவில் உங்களை தொடர்பு கொள்கிறோம்.\nநன்றி.",example:{body_text:[["Stalin"]]}}]},
 fsp_appointment_confirmed:{category:"UTILITY",language:"ta",components:[{type:"BODY",text:"வணக்கம் {{1}},\nFuture Secure Providers உடனான உங்கள் appointment உறுதி செய்யப்பட்டுள்ளது.\nதேதி: {{2}}\nநேரம்: {{3}}\nகுறிப்பிட்ட நேரத்தில் உங்களை தொடர்பு கொள்கிறோம்.\nநன்றி.",example:{body_text:[["Stalin","02-10-2026","10:30 AM"]]}}]},
 fsp_appointment_rescheduled:{category:"UTILITY",language:"ta",components:[{type:"BODY",text:"வணக்கம் {{1}},\nதவிர்க்க முடியாத காரணத்தினால், Future Secure Providers உடனான உங்கள் appointment நேரம் மாற்றியமைக்கப்பட்டுள்ளது.\nபுதிய தேதி: {{2}}\nபுதிய நேரம்: {{3}}\nஏற்பட்ட சிரமத்திற்கு வருந்துகிறோம். குறிப்பிட்ட புதிய நேரத்தில் உங்களை தொடர்பு கொள்கிறோம்.\nஉங்கள் புரிதலுக்கு நன்றி.\nFuture Secure Providers",example:{body_text:[["Stalin","04-10-2026","10:00 AM"]]}}]}
};
const json=(v:any,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{...cors,"Content-Type":"application/json"}});
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 try{
  const auth=req.headers.get("Authorization")||"",url=Deno.env.get("SUPABASE_URL")!,key=Deno.env.get("SUPABASE_ANON_KEY")!,token=Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  if(!token)throw new Error("WhatsApp access token is not configured");
  const sc=createClient(url,key,{global:{headers:{Authorization:auth}}});const {data:{user}}=await sc.auth.getUser();if(!user)return json({error:"Unauthorized"},401);
  const body=await req.json().catch(()=>({})),action=body.action||"list";
  if(action==="list"){
   const r=await metaFetch(`https://graph.facebook.com/${API}/${WABA}/message_templates?fields=id,name,status,category,language,components&limit=100`,{headers:{Authorization:`Bearer ${token}`}});
   const j=await r.json();if(!r.ok)return json({error:j?.error?.message||"Unable to load templates"},r.status);return json({ok:true,templates:j.data||[]});
  }
  let payload:any;
  if(action==="submit"){const name=String(body.name||"");const def=defs[name];if(!def)return json({error:"Template not allowed"},400);payload={name,...def};}
  else if(action==="create"){
   const name=String(body.name||"").trim().toLowerCase(),category=String(body.category||"").toUpperCase(),language=String(body.language||"").trim(),message=String(body.message||"").trim();
   if(!/^[a-z0-9_]{3,512}$/.test(name))return json({error:"Template name must use lowercase letters, numbers and underscores only."},400);
   if(!["UTILITY","MARKETING"].includes(category))return json({error:"Choose Utility or Marketing category."},400);
   if(!["ta","en_US"].includes(language))return json({error:"Unsupported language."},400);
   if(!message||message.length>1024)return json({error:"Message body is required and must be 1024 characters or less."},400);
   const nums=[...message.matchAll(/\{\{(\d+)\}\}/g)].map(x=>Number(x[1]));const max=nums.length?Math.max(...nums):0;
   for(let i=1;i<=max;i++)if(!nums.includes(i))return json({error:"Variables must be sequential: {{1}}, {{2}}, {{3}}..."},400);
   const comp:any={type:"BODY",text:message};if(max)comp.example={body_text:[Array.from({length:max},(_,i)=>`Sample ${i+1}`)]};
   payload={name,category,language,components:[comp]};
  } else return json({error:"Invalid action"},400);
  const r=await metaFetch(`https://graph.facebook.com/${API}/${WABA}/message_templates`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(payload)});
  const j=await r.json();return r.ok?json({ok:true,result:j}):json({error:j?.error?.message||"Template submission failed",details:j},r.status);
 }catch(e){return json({error:e instanceof Error?e.message:"Unexpected error"},500)}
});
