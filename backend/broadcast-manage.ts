import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const H = {"content-type":"application/json","access-control-allow-origin":"*","access-control-allow-headers":"authorization,x-client-info,apikey,content-type","access-control-allow-methods":"POST,OPTIONS"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:H});
const normalize=(v:unknown)=>{let s=String(v||"").replace(/\D/g,"");if(s.length===10)s="91"+s;return /^91[6-9]\d{9}$/.test(s)?s:"";};
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:H});
 if(req.method!=="POST")return reply({error:"Method not allowed"},405);
 try{
  const url=Deno.env.get("SUPABASE_URL")!,anon=Deno.env.get("SUPABASE_ANON_KEY")!,secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const bearer=req.headers.get("authorization")||"";
  const auth=createClient(url,anon,{global:{headers:{Authorization:bearer}}});
  const {data:{user},error}=await auth.auth.getUser();
  if(error||!user)return reply({error:"Unauthorized"},401);
  if(user.id!=="4bd1c093-0912-4e63-a062-21d8fd759357")return reply({error:"Forbidden"},403);
  const db=createClient(url,secret),input=await req.json(),action=String(input.action||"");
  if(action==="config"){const {data,error:e}=await db.from("broadcast_settings").select("send_enabled,mode").eq("id",true).maybeSingle();if(e)throw e;return reply({config:data||{send_enabled:false,mode:"test"}});}
  if(action==="optin_add"){
   const wa_id=normalize(input.phone),source=String(input.consent_source||""),reference=String(input.consent_reference||"").trim(),at=String(input.consent_at||"");
   if(!wa_id||!["website_form","crm_manual","imported_record"].includes(source)||reference.length<3||reference.length>500||!Number.isFinite(Date.parse(at))||Date.parse(at)>Date.now())return reply({error:"Valid Indian mobile, consent date and consent evidence are required."},400);
   const {error:e}=await db.rpc("broadcast_record_optin",{p_phone:wa_id,p_at:new Date(at).toISOString(),p_source:source,p_reference:reference,p_user:user.id});if(e)throw e;
   return reply({ok:true,wa_id});
  }
  if(action==="optout_add"){
   const wa_id=normalize(input.phone);if(!wa_id)return reply({error:"Invalid mobile"},400);
   const {error:e}=await db.rpc("broadcast_record_optout",{p_phone:wa_id,p_reason:String(input.reason||"Advisor recorded customer opt-out").slice(0,500)});if(e)throw e;
   return reply({ok:true,wa_id});
  }
  if(action==="optout_list"){
   const {data,error:e}=await db.from("broadcast_optouts").select("wa_id,reason").order("wa_id").limit(1000);if(e)throw e;return reply({optouts:data||[]});
  }
  if(action==="optin_list"){
   const {data,error:e}=await db.from("broadcast_optins").select("wa_id,consent_at,consent_source,consent_reference,revoked_at").is("revoked_at",null).order("consent_at",{ascending:false}).limit(1000);if(e)throw e;
   const phones=(data||[]).map(x=>x.wa_id),{data:out,error:oe}=phones.length?await db.from("broadcast_optouts").select("wa_id").in("wa_id",phones):{data:[],error:null};if(oe)throw oe;
   const blocked=new Set((out||[]).map(x=>x.wa_id));return reply({optins:(data||[]).filter(x=>!blocked.has(x.wa_id))});
  }
  if(action==="list"){
   const {data,error:e}=await db.from("broadcast_campaigns").select("id,title,template_name,template_language,status,send_mode,scheduled_at,created_at").eq("created_by",user.id).order("created_at",{ascending:false}).limit(100);if(e)throw e;
   const ids=(data||[]).map(x=>x.id),{data:rows,error:re}=ids.length?await db.from("broadcast_recipients").select("campaign_id,status").in("campaign_id",ids):{data:[],error:null};if(re)throw re;
   const campaigns=(data||[]).map(c=>{const rr=(rows||[]).filter(x=>x.campaign_id===c.id);return {...c,total:rr.length,sent:rr.filter(x=>["sent","delivered","read"].includes(x.status)).length,skipped:rr.filter(x=>x.status==="skipped").length,delivered:rr.filter(x=>["delivered","read"].includes(x.status)).length,read:rr.filter(x=>x.status==="read").length,failed:rr.filter(x=>x.status==="failed").length,queued:rr.filter(x=>["pending","queued"].includes(x.status)).length};});
   return reply({campaigns});
  }
  if(action==="create"){
   const title=String(input.title||"").trim(),name=String(input.template_name||"").trim(),language=String(input.language||"").trim(),variables=input.template_variables||{};
   if(!title||title.length>150||!/^[a-z0-9_]{3,512}$/.test(name)||!/^[a-z]{2}(_[A-Z]{2})?$/.test(language)||typeof variables!=="object"||variables===null||Array.isArray(variables)||JSON.stringify(variables).length>10000||Object.entries(variables).some(([k,v])=>!/^\d+$/.test(k)||typeof v!=="string"||v.length>1024))return reply({error:"Invalid campaign fields"},400);
   const request_id=String(input.request_id||"");
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request_id))return reply({error:"Valid request ID required"},400);
   const {data:existing,error:xe}=await db.from("broadcast_campaigns").select("id").eq("created_by",user.id).eq("request_id",request_id).maybeSingle();if(xe)throw xe;if(existing)return reply({campaign:existing});
   const {data,error:e}=await db.from("broadcast_campaigns").insert({request_id,created_by:user.id,title,template_name:name,template_language:language,template_variables:variables,status:"draft"}).select("id").single();if(e){if(e.code==="23505"){const {data:again,error:ae}=await db.from("broadcast_campaigns").select("id").eq("created_by",user.id).eq("request_id",request_id).single();if(ae)throw ae;return reply({campaign:again});}throw e;}return reply({campaign:data});
  }
  const id=String(input.campaign_id||"");
  const {data:campaign,error:ce}=await db.from("broadcast_campaigns").select("*").eq("id",id).eq("created_by",user.id).maybeSingle();
  if(ce||!campaign)return reply({error:"Campaign not found"},404);
  if(action==="recipients"){
   if(campaign.status!=="draft")return reply({error:"Campaign locked"},409);
   const rows=Array.isArray(input.recipients)?input.recipients:[];if(!rows.length||rows.length>500)return reply({error:"Select 1-500 recipients"},400);
   const unique=new Map<string,{wa_id:string;display_name:string;consent_at:string;consent_source:string;consent_reference:string}>();
   for(const r of rows){const wa_id=normalize(r.phone);if(!wa_id)return reply({error:"Invalid recipient number"},400);unique.set(wa_id,{wa_id,display_name:String(r.name||"").slice(0,120),consent_at:"",consent_source:"",consent_reference:""});}
   const phones=[...unique.keys()];
   const {data:consents,error:e}=await db.from("broadcast_optins").select("wa_id,consent_at,consent_source,consent_reference").in("wa_id",phones).is("revoked_at",null);if(e)throw e;
   const consentMap=new Map((consents||[]).map(x=>[x.wa_id,x]));
   const {data:outs,error:oe}=await db.from("broadcast_optouts").select("wa_id").in("wa_id",phones);if(oe)throw oe;const blocked=new Set((outs||[]).map(x=>x.wa_id));
   const eligible=phones.filter(p=>consentMap.has(p)&&!blocked.has(p));if(!eligible.length)return reply({error:"No eligible recipients with active recorded marketing consent"},400);
   const payload=eligible.map(p=>{const c=consentMap.get(p)!;return {...unique.get(p)!,consent_at:c.consent_at,consent_source:c.consent_source,consent_reference:c.consent_reference,campaign_id:id,status:"pending"};});
   const {error:re}=await db.from("broadcast_recipients").upsert(payload,{onConflict:"campaign_id,wa_id",ignoreDuplicates:true});if(re)throw re;
   return reply({ok:true,eligible:eligible.length,excluded:phones.length-eligible.length});
  }
  if(action==="approve"){
   if(campaign.status!=="draft")return reply({error:"Campaign is not a draft"},409);
   const scheduled=String(input.scheduled_at||"");
   if(scheduled&&(!Number.isFinite(Date.parse(scheduled))||Date.parse(scheduled)<Date.now()-30000))return reply({error:"Choose a future schedule"},400);
   const {data:settings}=await db.from("broadcast_settings").select("send_enabled,mode").eq("id",true).maybeSingle();
   if(!settings?.send_enabled||settings.mode!=="live")return reply({error:"Broadcast sending is disabled until the Meta test-number validation passes."},409);
   if(!(Deno.env.get("WHATSAPP_APP_SECRET")||Deno.env.get("META_APP_SECRET")))return reply({error:"Webhook signature secret is required before live sending"},409);
   const tr=await fetch("https://graph.facebook.com/v23.0/922433197569331/message_templates?fields=name,status,language,category,components&limit=100",{headers:{Authorization:"Bearer "+(Deno.env.get("WHATSAPP_ACCESS_TOKEN")||"")}});
   const tj=await tr.json(),tpl=(tj.data||[]).find((x:any)=>x.name===campaign.template_name&&x.language===campaign.template_language&&x.status==="APPROVED"&&x.category==="MARKETING");
   if(!tr.ok||!tpl)return reply({error:"An approved Meta marketing template is required"},422);
   const comps=tpl.components||[],body=String(comps.find((x:any)=>x.type==="BODY")?.text||""),nums=[...new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map(m=>Number(m[1])))].sort((a,b)=>a-b);
   if(comps.some((x:any)=>(x.type==="HEADER"&&(x.format!=="TEXT"||/\{\{/.test(x.text||"")))||(x.type==="BUTTONS"&&x.buttons?.some((b:any)=>b.type==="URL"&&/\{\{/.test(b.url||"")))))return reply({error:"Use a text template without dynamic header or URL buttons"},422);
   if(nums.some((n,i)=>n!==i+1||(n!==1&&!String(campaign.template_variables?.[String(n)]||"").trim())))return reply({error:"Complete all sequential template variables"},422);
   const {count,error:re}=await db.from("broadcast_recipients").select("id",{count:"exact",head:true}).eq("campaign_id",id).eq("status","pending");if(re)throw re;if(!count)return reply({error:"No eligible recipients"},400);
   const at=scheduled?new Date(scheduled).toISOString():new Date().toISOString();
   const {data:changed,error:e}=await db.from("broadcast_campaigns").update({status:"scheduled",scheduled_at:at,approved_at:new Date().toISOString(),approved_by:user.id}).eq("id",id).eq("status","draft").select("id").maybeSingle();if(e)throw e;if(!changed)return reply({error:"Campaign already queued or changed"},409);
   return reply({ok:true,status:"scheduled",recipients:count,scheduled_at:at});
  }
  if(action==="report"){
   const {data:rows,error:e}=await db.from("broadcast_recipients").select("wa_id,display_name,status,attempts,error_text,sent_at,delivered_at,read_at,meta_message_id,created_at").eq("campaign_id",id).order("created_at");if(e)throw e;return reply({recipients:rows||[]});
  }
  if(action==="cancel"){
   const {data:changed,error:e}=await db.from("broadcast_campaigns").update({status:"cancelled"}).eq("id",id).in("status",["draft","scheduled","paused"]).select("id").maybeSingle();if(e)throw e;if(!changed)return reply({error:"Campaign has finished or cannot be cancelled"},409);return reply({ok:true});
  }
  return reply({error:"Unknown action"},400);
 }catch(e){console.error(e);return reply({error:"Request failed"},500)}
});
