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
const WABA="922433197569331",PHONE="1248446071686225";
Deno.serve(async(req)=>{
 if(req.method!=="POST")return new Response("Method Not Allowed",{status:405});
 try{
  const auth=req.headers.get("Authorization")||"",url=Deno.env.get("SUPABASE_URL")!,anon=Deno.env.get("SUPABASE_ANON_KEY")!,service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,token=Deno.env.get("WHATSAPP_ACCESS_TOKEN")!;
  const uc=createClient(url,anon,{global:{headers:{Authorization:auth}}});const {data:{user}}=await uc.auth.getUser();if(!user)return Response.json({error:"Unauthorized"},{status:401});
  const db=createClient(url,service);const {data:jobs,error}=await db.from("whatsapp_automation_queue").select("*").eq("status","pending").lt("attempts",5).order("id").limit(20);if(error)throw error;
  let sent=0,failed=0;
  for(const job of jobs||[]){
   const {data:claimed}=await db.from("whatsapp_automation_queue").update({status:"processing"}).eq("id",job.id).eq("status","pending").select("id").maybeSingle();if(!claimed)continue;
   const r=job.payload||{};let to=String(r.mobile_number||"").replace(/\D/g,"");if(/^\d{10}$/.test(to))to="91"+to;
   let name="",params=[];
   if(job.event_type==="new_enquiry"){name="fsp_new_enquiry_received";params=[String(r.full_name||"Customer").trim()||"Customer"];}
   else if(job.event_type==="appointment_confirmed"){let d=String(r.appointment_date||""),p=d.split("-");if(p.length===3)d=p[2]+"-"+p[1]+"-"+p[0];name="fsp_appointment_confirmed";params=[String(r.customer_name||"Customer").trim()||"Customer",d,String(r.appointment_time||"")];}
   else {await db.from("whatsapp_automation_queue").update({status:"failed",last_error:"Unknown event",attempts:job.attempts+1}).eq("id",job.id);failed++;continue}
   const tr=await metaFetch("https://graph.facebook.com/v23.0/"+WABA+"/message_templates?fields=name,status,language,components&limit=100",{headers:{Authorization:"Bearer "+token}}),tj=await tr.json(),tpl=(tj.data||[]).find(x=>x.name===name&&x.status==="APPROVED");
   if(!tpl){await db.from("whatsapp_automation_queue").update({status:"failed",last_error:"Template not approved",attempts:job.attempts+1}).eq("id",job.id);failed++;continue}
   const payload={messaging_product:"whatsapp",to,type:"template",template:{name,language:{code:tpl.language},components:[{type:"body",parameters:params.map(x=>({type:"text",text:x}))}]}};
   const mr=await metaFetch("https://graph.facebook.com/v23.0/"+PHONE+"/messages",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify(payload)}),mj=await mr.json();
   if(!mr.ok){await db.from("whatsapp_automation_queue").update({status:(job.attempts+1)>=5?"failed":"pending",last_error:mj?.error?.message||"Send failed",attempts:job.attempts+1}).eq("id",job.id);failed++;continue}
   const mid=mj?.messages?.[0]?.id,now=new Date().toISOString(),bodyText=String((tpl.components||[]).find(x=>x.type==="BODY")?.text||name).replace(/\{\{(\d+)\}\}/g,(_,i)=>params[Number(i)-1]||"");
   if(mid){
     const {error:contactErr}=await db.from("whatsapp_contacts").upsert({wa_id:to,phone_number:to,last_message_at:now,updated_at:now},{onConflict:"wa_id"});
     if(contactErr)throw contactErr;
     const {error:msgErr}=await db.from("whatsapp_messages").upsert({meta_message_id:mid,wa_id:to,direction:"outbound",message_type:"template",message_text:bodyText,message_timestamp:now,raw_payload:mj},{onConflict:"meta_message_id",ignoreDuplicates:true});
     if(msgErr)throw msgErr;
   }
   await db.from("whatsapp_automation_queue").update({status:"sent",processed_at:now,last_error:null,attempts:job.attempts+1}).eq("id",job.id);sent++;
  }
  return Response.json({ok:true,processed:(jobs||[]).length,sent,failed});
 }catch(e){console.error(e);return Response.json({error:e instanceof Error?e.message:"Unexpected error"},{status:500})}
});
