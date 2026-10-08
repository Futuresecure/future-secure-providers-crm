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
const json=(v:any,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{...cors,"Content-Type":"application/json"}});
const appError=(message:string,details:any=null)=>json({ok:false,error:message,details},200);
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors}); if(req.method!=="POST")return json({error:"Method Not Allowed"},405);
 try{
  const auth=req.headers.get("Authorization")||"",url=Deno.env.get("SUPABASE_URL")!,anon=Deno.env.get("SUPABASE_ANON_KEY")!,service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,token=Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  if(!token)throw new Error("WHATSAPP_ACCESS_TOKEN is not configured");
  const uc=createClient(url,anon,{global:{headers:{Authorization:auth}}});const {data:{user},error:ue}=await uc.auth.getUser();if(ue||!user)return json({error:"Unauthorized"},401);
  const input=await req.json(),to=String(input.wa_id||"").replace(/\D/g,"");if(!/^\d{8,15}$/.test(to))return appError("Invalid recipient");
  let payload:any,displayText="",messageType="text";
  if(input.type==="media"){
   const mediaType=String(input.media_type||"").toLowerCase(),fileName=String(input.file_name||"attachment").slice(0,240),mime=String(input.mime_type||"application/octet-stream"),caption=String(input.caption||"").trim(),b64=String(input.file_base64||"");
   if(!["image","document","video"].includes(mediaType)||!b64)return appError("Invalid attachment");
   const allowedMime=/^(image\/|video\/|application\/pdf$|text\/plain$|application\/(msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document|vnd\.ms-excel|vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|vnd\.ms-powerpoint|vnd\.openxmlformats-officedocument\.presentationml\.presentation)$)/;
   if(!allowedMime.test(mime))return appError("Unsupported attachment type");
   if(caption.length>1024)return appError("Caption is too long");
   let bytes:Uint8Array;try{bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0))}catch{return appError("Invalid attachment data")}if(bytes.byteLength>16*1024*1024)return appError("Attachment is too large. Maximum 16 MB.");
   const fd=new FormData();fd.append("messaging_product","whatsapp");fd.append("type",mime);fd.append("file",new Blob([bytes],{type:mime}),fileName);
   const ur=await metaFetch("https://graph.facebook.com/v23.0/1248446071686225/media",{method:"POST",headers:{Authorization:`Bearer ${token}`},body:fd}),uj=await ur.json();
   if(!ur.ok||!uj?.id)return appError(uj?.error?.message||"Attachment upload failed",uj?.error||null);
   const media:any={id:uj.id};if(caption)media.caption=caption;if(mediaType==="document")media.filename=fileName;
   payload={messaging_product:"whatsapp",recipient_type:"individual",to,type:mediaType,[mediaType]:media};
   displayText=caption||("📎 "+fileName);messageType=mediaType;
  } else if(input.type==="template"){
   const name=String(input.template_name||"").trim(),language=String(input.language||"").trim(),params=Array.isArray(input.parameters)?input.parameters.map((v:any)=>String(v??"").trim()):[];
   if(!/^[a-z0-9_]{3,512}$/.test(name)||!language)return appError("Invalid template");
   const tr=await metaFetch("https://graph.facebook.com/v23.0/922433197569331/message_templates?fields=name,status,language,components&limit=100",{headers:{Authorization:`Bearer ${token}`}});
   const tj=await tr.json();if(!tr.ok)return appError(tj?.error?.message||"Unable to verify template",tj?.error||null);
   const tpl=(tj.data||[]).find((x:any)=>x.name===name&&x.language===language);
   if(!tpl)return appError(`Template ${name} (${language}) was not found in this WhatsApp Business Account`);
   if(tpl.status!=="APPROVED")return appError(`Template status is ${tpl.status}. Only APPROVED templates can be sent`);
   const bodyComp=(tpl.components||[]).find((x:any)=>x.type==="BODY"),text=String(bodyComp?.text||"");const nums=[...text.matchAll(/\{\{(\d+)\}\}/g)].map((m:any)=>Number(m[1])),count=nums.length?Math.max(...nums):0;
   if(params.length!==count||params.some((x:string)=>!x))return appError(`This template requires ${count} variable value(s), but ${params.length} were provided`);
   const components=count?[{type:"body",parameters:params.map((x:string)=>({type:"text",text:x}))}]:[];
   payload={messaging_product:"whatsapp",recipient_type:"individual",to,type:"template",template:{name,language:{code:language},components}};
   displayText=text.replace(/\{\{(\d+)\}\}/g,(_:string,n:string)=>params[Number(n)-1]||`{{${n}}}`);messageType="template";
  }else{
   const body=String(input.message||"").trim();if(!body||body.length>4096)return appError("Invalid message");
   payload={messaging_product:"whatsapp",recipient_type:"individual",to,type:"text",text:{preview_url:false,body}};displayText=body;
  }
  const gr=await metaFetch("https://graph.facebook.com/v23.0/1248446071686225/messages",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(payload)}),graph=await gr.json();
  if(!gr.ok){console.error("Meta send error",JSON.stringify(graph));return appError(graph?.error?.message||"WhatsApp send failed",graph?.error||null);}const metaId=graph?.messages?.[0]?.id;if(!metaId)throw new Error("Meta did not return a message ID");
  const admin=createClient(url,service),now=new Date().toISOString();
  const {error:me}=await admin.from("whatsapp_messages").upsert({meta_message_id:metaId,wa_id:to,direction:"outbound",message_type:messageType,message_text:displayText,message_timestamp:now,raw_payload:graph},{onConflict:"meta_message_id",ignoreDuplicates:true});if(me)console.error("Outbound save error",me);
  const {data:existing}=await admin.from("whatsapp_contacts").select("wa_id").eq("wa_id",to).maybeSingle();
  if(existing)await admin.from("whatsapp_contacts").update({last_message_at:now,updated_at:now}).eq("wa_id",to);else await admin.from("whatsapp_contacts").insert({wa_id:to,phone_number:to,last_message_at:now,updated_at:now});
  return json({ok:true,message_id:metaId});
 }catch(e){console.error(e);return json({error:e instanceof Error?e.message:"Unexpected error"},500)}
});
