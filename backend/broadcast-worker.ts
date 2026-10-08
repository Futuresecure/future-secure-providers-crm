import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.57.4";

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
async function processBroadcastQueue(db:any,token:string,testScope?:string[]){
 const {data:cfg,error:cfgErr}=await db.from("broadcast_settings").select("send_enabled,mode").eq("id",true).maybeSingle();
 if(cfgErr)throw cfgErr;if(!testScope&&(!cfg?.send_enabled||cfg.mode!=="live"||!(Deno.env.get("WHATSAPP_APP_SECRET")||Deno.env.get("META_APP_SECRET"))))return {broadcast:"disabled",sent:0,failed:0,skipped:0};
 const WABA="922433197569331",PHONE=testScope?"917299278124316":"1248446071686225";
 if(testScope){const sr=await metaFetch("https://graph.facebook.com/v23.0/"+PHONE+"?fields=id,display_phone_number,verified_name",{headers:{Authorization:"Bearer "+token}}),sj=await sr.json();if(!sr.ok||sj.verified_name!=="Test Number"||!String(sj.display_phone_number).replace(/\D/g,"").startsWith("1555"))throw Error("Not a Meta test sender");}
 const stale=new Date(Date.now()-600000).toISOString();
 let cq=db.from("broadcast_campaigns").select("*").eq("status","scheduled").eq("send_mode",testScope?"test":"live").lte("scheduled_at",new Date().toISOString()).order("scheduled_at").limit(5);if(testScope)cq=cq.in("id",testScope);const {data:campaigns,error}=await cq;if(error)throw error;
 let sent=0,failed=0,skipped=0;
 for(const campaign of campaigns||[]){
  const {error:staleError}=await db.from("broadcast_recipients").update({status:"failed",error_text:"Dispatch outcome unknown after interrupted worker; not retried"}).eq("campaign_id",campaign.id).eq("status","queued").lt("claimed_at",stale);if(staleError)throw staleError;
  const tplRes=testScope?null:await metaFetch("https://graph.facebook.com/v23.0/"+WABA+"/message_templates?fields=name,status,language,category,components&limit=100",{headers:{Authorization:"Bearer "+token}});
  const tplData=tplRes?await tplRes.json():{data:[]},tpl=testScope?{name:"hello_world",language:"en_US",components:[{type:"BODY",text:"Meta hello_world — CRM Broadcast test"}]}:(tplData.data||[]).find((x:any)=>x.name===campaign.template_name&&x.language===campaign.template_language&&x.status==="APPROVED");
  if(!tpl){await db.from("broadcast_recipients").update({status:"failed",error_text:"Approved template unavailable"}).eq("campaign_id",campaign.id).eq("status","pending");await db.from("broadcast_campaigns").update({status:"completed"}).eq("id",campaign.id);failed++;continue;}
  const {data:recipients,error:re}=await db.from("broadcast_recipients").select("*").eq("campaign_id",campaign.id).eq("status","pending").order("created_at").limit(10);if(re)throw re;
  for(const r of recipients||[]){
   if(testScope&&r.wa_id!=="919585905905"){await db.from("broadcast_recipients").update({status:"skipped",error_text:"Test recipient not allowed"}).eq("id",r.id);skipped++;continue;}
   const {data:current,error:currentError}=await db.from("broadcast_campaigns").select("status").eq("id",campaign.id).single();if(currentError)throw currentError;if(current.status!=="scheduled")break;
   if(!testScope){const {data:latestCfg,error:latestError}=await db.from("broadcast_settings").select("send_enabled,mode").eq("id",true).single();if(latestError)throw latestError;if(!latestCfg.send_enabled||latestCfg.mode!=="live")break;}
   const {data:consent,error:consentError}=await db.from("broadcast_optins").select("wa_id").eq("wa_id",r.wa_id).is("revoked_at",null).maybeSingle();if(consentError)throw consentError;
   const {data:optout,error:optoutError}=await db.from("broadcast_optouts").select("wa_id").eq("wa_id",r.wa_id).maybeSingle();if(optoutError)throw optoutError;
   if(!consent||optout){await db.from("broadcast_recipients").update({status:"skipped",error_text:optout?"Customer opted out":"No active marketing opt-in"}).eq("id",r.id).eq("status","pending");skipped++;continue;}
   const {data:claim}=await db.from("broadcast_recipients").update({status:"queued",claimed_at:new Date().toISOString(),attempts:(r.attempts||0)+1,error_text:null}).eq("id",r.id).eq("status","pending").select("id").maybeSingle();if(!claim)continue;
   const body=String((tpl.components||[]).find((x:any)=>x.type==="BODY")?.text||"");
   const nums=[...new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map((m:any)=>Number(m[1])))].sort((a,b)=>a-b);
   const vars=campaign.template_variables||{};
   const parameters=nums.map((n:number)=>({type:"text",text:String(vars[String(n)]??(n===1?(r.display_name||"Customer"):"")).slice(0,1024)}));
   const payload={messaging_product:"whatsapp",to:r.wa_id,type:"template",template:{name:campaign.template_name,language:{code:campaign.template_language},components:parameters.length?[{type:"body",parameters}]:[]}};
   let mr:any,mj:any,uncertain=false;
   try{mr=await metaFetch("https://graph.facebook.com/v23.0/"+PHONE+"/messages",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});mj=await mr.json();}
   catch(_e){uncertain=true;mj={error:{message:"Provider outcome unknown; not retried to avoid duplicate delivery"}};mr={ok:false};}
   if(!mr.ok){const retry=(r.attempts||0)+1,status=uncertain||retry>=3||![429,500,502,503,504].includes(mr.status)?"failed":"pending";await db.from("broadcast_recipients").update({status,error_text:String(mj?.error?.message||"WhatsApp send failed").slice(0,500),attempts:retry}).eq("id",r.id);failed++;continue;}
   const metaId=mj?.messages?.[0]?.id;if(!metaId){await db.from("broadcast_recipients").update({status:"failed",error_text:"Provider accepted without message ID; not retried"}).eq("id",r.id);failed++;continue;}const now=new Date().toISOString();
   const rendered=body.replace(/\{\{(\d+)\}\}/g,(_:string,n:string)=>String(vars[n]??(Number(n)===1?(r.display_name||"Customer"):"")));
   const {error:saveErr}=await db.from("broadcast_recipients").update({status:"sent",meta_message_id:metaId||null,sent_at:now,error_text:null}).eq("id",r.id).eq("status","queued");if(saveErr)throw saveErr;
   if(metaId){await db.from("whatsapp_contacts").upsert({wa_id:r.wa_id,phone_number:r.wa_id,updated_at:now},{onConflict:"wa_id"});const {error:msgErr}=await db.from("whatsapp_messages").upsert({meta_message_id:metaId,wa_id:r.wa_id,direction:"outbound",message_type:"template",message_text:rendered,message_timestamp:now,raw_payload:mj},{onConflict:"meta_message_id",ignoreDuplicates:true});if(msgErr)console.error("Broadcast inbox save error",msgErr);}
   const {error:deliveryError}=await db.rpc("broadcast_apply_delivery",{p_meta_id:metaId,p_status:"sent",p_at:now,p_error:null});if(deliveryError)console.error("Broadcast delivery reconciliation error",deliveryError);
   sent++;
  }
  const {count}=await db.from("broadcast_recipients").select("id",{count:"exact",head:true}).eq("campaign_id",campaign.id).in("status",["pending","queued"]);
  if(!count)await db.from("broadcast_campaigns").update({status:"completed"}).eq("id",campaign.id).eq("status","scheduled");
 }
 return {broadcast:testScope?"test":"live",sent,failed,skipped};
}

Deno.serve(async req=>{
 if(req.method!=="POST")return new Response("Method not allowed",{status:405});
 const supplied=req.headers.get("x-fsp-broadcast-token")||"";
 const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(supplied)));
 const received=[...digest].map(x=>x.toString(16).padStart(2,"0")).join(""),expected="9223db0b64faba4b2547f61f147ef287c9179219d1e8d1e08f53bc7cb4ccc452";
 let diff=received.length^expected.length;for(let i=0;i<expected.length;i++)diff|=received.charCodeAt(i)^expected.charCodeAt(i);
 if(diff!==0)return new Response("Unauthorized",{status:401});
 try{
 const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
 const token=Deno.env.get("WHATSAPP_ACCESS_TOKEN");
 if(!token)return Response.json({error:"WhatsApp token unavailable"},{status:503});
 return Response.json(await processBroadcastQueue(db,token));
 }catch(e){console.error("Broadcast worker failed",e);return Response.json({error:"Broadcast processing failed"},{status:500});}
});

