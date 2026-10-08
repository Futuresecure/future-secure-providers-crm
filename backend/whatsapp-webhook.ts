import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const VERIFY_TOKEN = "fsp_meta_webhook_2026";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

async function processBroadcastQueue(db:any,token:string,testScope?:string[]){
 const {data:cfg,error:cfgErr}=await db.from("broadcast_settings").select("send_enabled,mode").eq("id",true).maybeSingle();
 if(cfgErr)throw cfgErr;if(!testScope&&(!cfg?.send_enabled||cfg.mode!=="live"||!(Deno.env.get("WHATSAPP_APP_SECRET")||Deno.env.get("META_APP_SECRET"))))return {broadcast:"disabled",sent:0,failed:0,skipped:0};
 const WABA="922433197569331",PHONE=testScope?"917299278124316":"1248446071686225";
 if(testScope){const sr=await fetch("https://graph.facebook.com/v23.0/"+PHONE+"?fields=id,display_phone_number,verified_name",{headers:{Authorization:"Bearer "+token}}),sj=await sr.json();if(!sr.ok||sj.verified_name!=="Test Number"||!String(sj.display_phone_number).replace(/\D/g,"").startsWith("1555"))throw Error("Not a Meta test sender");}
 const stale=new Date(Date.now()-600000).toISOString();
 let cq=db.from("broadcast_campaigns").select("*").eq("status","scheduled").eq("send_mode",testScope?"test":"live").lte("scheduled_at",new Date().toISOString()).order("scheduled_at").limit(5);if(testScope)cq=cq.in("id",testScope);const {data:campaigns,error}=await cq;if(error)throw error;
 let sent=0,failed=0,skipped=0;
 for(const campaign of campaigns||[]){
  const {error:staleError}=await db.from("broadcast_recipients").update({status:"failed",error_text:"Dispatch outcome unknown after interrupted worker; not retried"}).eq("campaign_id",campaign.id).eq("status","queued").lt("claimed_at",stale);if(staleError)throw staleError;
  const tplRes=testScope?null:await fetch("https://graph.facebook.com/v23.0/"+WABA+"/message_templates?fields=name,status,language,category,components&limit=100",{headers:{Authorization:"Bearer "+token}});
  const tplData=tplRes?await tplRes.json():{data:[]},tpl=testScope?{name:"hello_world",language:"en_US",components:[{type:"BODY",text:"Meta hello_world — CRM Broadcast test"}]}:(tplData.data||[]).find((x:any)=>x.name===campaign.template_name&&x.language===campaign.template_language&&x.status==="APPROVED"&&x.category==="MARKETING");
  if(!tpl){await db.from("broadcast_recipients").update({status:"failed",error_text:"Approved marketing template unavailable"}).eq("campaign_id",campaign.id).eq("status","pending");await db.from("broadcast_campaigns").update({status:"completed"}).eq("id",campaign.id);failed++;continue;}
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
   try{mr=await fetch("https://graph.facebook.com/v23.0/"+PHONE+"/messages",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});mj=await mr.json();}
   catch(_e){uncertain=true;mj={error:{message:"Provider outcome unknown; not retried to avoid duplicate delivery"}};mr={ok:false};}
   if(!mr.ok){const retry=(r.attempts||0)+1,status=uncertain||retry>=3||![429,500,502,503,504].includes(mr.status)?"failed":"pending";await db.from("broadcast_recipients").update({status,error_text:String(mj?.error?.message||"WhatsApp send failed").slice(0,500),attempts:retry}).eq("id",r.id);failed++;continue;}
   const metaId=mj?.messages?.[0]?.id;if(!metaId){await db.from("broadcast_recipients").update({status:"failed",error_text:"Provider accepted without message ID; not retried"}).eq("id",r.id);failed++;continue;}const now=new Date().toISOString();
   const rendered=body.replace(/\{\{(\d+)\}\}/g,(_:string,n:string)=>String(vars[n]??(Number(n)===1?(r.display_name||"Customer"):"")));
   const {error:saveErr}=await db.from("broadcast_recipients").update({status:"sent",meta_message_id:metaId||null,sent_at:now,error_text:null}).eq("id",r.id).eq("status","queued");if(saveErr)throw saveErr;
   if(metaId){await db.from("whatsapp_contacts").upsert({wa_id:r.wa_id,phone_number:r.wa_id,updated_at:now},{onConflict:"wa_id"});const {error:msgErr}=await db.from("whatsapp_messages").upsert({meta_message_id:metaId,wa_id:r.wa_id,direction:"outbound",message_type:"template",message_text:rendered,message_timestamp:now,raw_payload:mj},{onConflict:"meta_message_id",ignoreDuplicates:true});if(msgErr)console.error("Broadcast inbox save error",msgErr);}
   sent++;
  }
  const {count}=await db.from("broadcast_recipients").select("id",{count:"exact",head:true}).eq("campaign_id",campaign.id).in("status",["pending","queued"]);
  if(!count)await db.from("broadcast_campaigns").update({status:"completed"}).eq("id",campaign.id).eq("status","scheduled");
 }
 return {broadcast:testScope?"test":"live",sent,failed,skipped};
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // Meta webhook verification
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (
      mode === "subscribe" &&
      token === VERIFY_TOKEN &&
      challenge
    ) {
      return new Response(challenge, { status: 200 });
    }

    return new Response("Forbidden", { status: 403 });
  }

  // Receive WhatsApp events / protected internal automation worker
  if (req.method === "POST") {
    try {
      const rawBody=await req.text();const body=JSON.parse(rawBody);
      let signed=false;const appSecret=Deno.env.get("WHATSAPP_APP_SECRET")||Deno.env.get("META_APP_SECRET");
      if(appSecret&&body?.internal_action!=="process_automation_queue"){
       const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(appSecret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
       const digest=new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(rawBody)));
       const expected="sha256="+[...digest].map(x=>x.toString(16).padStart(2,"0")).join("");
       const received=req.headers.get("x-hub-signature-256")||"";let diff=received.length^expected.length;for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^(received.charCodeAt(i)||0);signed=diff===0;
       if(!signed)return new Response("Invalid signature",{status:403});
      }
      if (body?.internal_action === "process_automation_queue") {
        if (url.searchParams.get("internal_token") !== VERIFY_TOKEN) return new Response("Forbidden",{status:403});
        const metaToken=Deno.env.get("WHATSAPP_ACCESS_TOKEN"); if(!metaToken) return new Response("Missing WhatsApp token",{status:500});
        const {data:jobs,error:qerr}=await supabase.from("whatsapp_automation_queue").select("*").eq("status","pending").lt("attempts",5).order("id").limit(20); if(qerr) throw qerr;
        let sent=0,failed=0;
        for(const job of jobs??[]){
          const {data:claimed}=await supabase.from("whatsapp_automation_queue").update({status:"processing"}).eq("id",job.id).eq("status","pending").select("id").maybeSingle();if(!claimed)continue;
          const r=job.payload??{}; let to=String(r.mobile_number??"").replace(/\D/g,""); if(/^\d{10}$/.test(to))to="91"+to;
          let templateName="",params:string[]=[];
          if(job.event_type==="new_enquiry"){templateName="fsp_new_enquiry_received";params=[String(r.full_name??"Customer").trim()||"Customer"];}
          else if(job.event_type==="appointment_confirmed"){let d=String(r.appointment_date??""),p=d.split("-");if(p.length===3)d=p[2]+"-"+p[1]+"-"+p[0];templateName="fsp_appointment_confirmed";params=[String(r.customer_name??"Customer").trim()||"Customer",d,String(r.appointment_time??"")];}
          else {await supabase.from("whatsapp_automation_queue").update({status:"failed",attempts:(job.attempts??0)+1,last_error:"Unknown event"}).eq("id",job.id);failed++;continue;}
          const tr=await fetch("https://graph.facebook.com/v23.0/922433197569331/message_templates?fields=name,status,language,components&limit=100",{headers:{Authorization:"Bearer "+metaToken}});const tj=await tr.json();const tpl=(tj.data??[]).find((x:any)=>x.name===templateName&&x.status==="APPROVED");
          if(!tpl){await supabase.from("whatsapp_automation_queue").update({status:"failed",attempts:(job.attempts??0)+1,last_error:"Template not approved"}).eq("id",job.id);failed++;continue;}
          const payload={messaging_product:"whatsapp",to,type:"template",template:{name:templateName,language:{code:tpl.language},components:[{type:"body",parameters:params.map(x=>({type:"text",text:x}))}]}};
          const mr=await fetch("https://graph.facebook.com/v23.0/1248446071686225/messages",{method:"POST",headers:{Authorization:"Bearer "+metaToken,"Content-Type":"application/json"},body:JSON.stringify(payload)});const mj=await mr.json();
          if(!mr.ok){const attempts=(job.attempts??0)+1;await supabase.from("whatsapp_automation_queue").update({status:attempts>=5?"failed":"pending",attempts,last_error:mj?.error?.message??"Send failed"}).eq("id",job.id);failed++;continue;}
          const mid=mj?.messages?.[0]?.id,now=new Date().toISOString(),txt=String((tpl.components??[]).find((x:any)=>x.type==="BODY")?.text??templateName).replace(/\{\{(\d+)\}\}/g,(_:string,i:string)=>params[Number(i)-1]??"");
          if(mid){
            const {error:contactErr}=await supabase.from("whatsapp_contacts").upsert({wa_id:to,phone_number:to,last_message_at:now,updated_at:now},{onConflict:"wa_id"});
            if(contactErr)throw contactErr;
            const {error:msgErr}=await supabase.from("whatsapp_messages").upsert({meta_message_id:mid,wa_id:to,direction:"outbound",message_type:"template",message_text:txt,message_timestamp:now,raw_payload:mj},{onConflict:"meta_message_id",ignoreDuplicates:true});
            if(msgErr)throw msgErr;
          }
          await supabase.from("whatsapp_automation_queue").update({status:"sent",attempts:(job.attempts??0)+1,last_error:null,processed_at:now}).eq("id",job.id);sent++;
        }
        const broadcastResult=await processBroadcastQueue(supabase,metaToken); return Response.json({ok:true,processed:(jobs??[]).length,sent,failed,...broadcastResult});
      }

      console.log(
        "WhatsApp webhook event:",
        JSON.stringify(body)
      );

      for (const entry of body?.entry ?? []) {
        for (const change of entry?.changes ?? []) {
          if (change?.field !== "messages") continue;

          const value = change?.value ?? {};
          for (const status of value?.statuses ?? []) {
            if (!status?.id || !status?.status) continue;
            const statusTime = status.timestamp ? new Date(Number(status.timestamp) * 1000).toISOString() : new Date().toISOString();
            const patch: Record<string, unknown> = { delivery_status: String(status.status), status_timestamp: statusTime };
            if (status.status === "read") patch.read_at = statusTime;
            const mapped = ["sent","delivered","read","failed"].includes(String(status.status)) ? String(status.status) : null;
            if (mapped && (signed || !appSecret)) {
              const {data:br}=await supabase.from("broadcast_recipients").select("id,status").eq("meta_message_id",String(status.id)).maybeSingle();
              const rank:any={pending:0,queued:0,sent:1,delivered:2,read:3,failed:0};
              if(br && (mapped==="failed"?!["delivered","read"].includes(br.status):(rank[mapped]??0)>=(rank[br.status]??0))){
                const {error:bse}=await supabase.from("broadcast_recipients").update({status:mapped,...(mapped==="delivered"?{delivered_at:statusTime}:mapped==="read"?{read_at:statusTime}:{}),error_text:status.status==="failed"?String(status.errors?.[0]?.title||status.errors?.[0]?.message||"Delivery failed").slice(0,500):null}).eq("id",br.id).eq("status",br.status);
                if(bse)console.error("Broadcast status save error:",bse);
              }
            }
            const {data:existingStatus,error:existingError}=await supabase.from("whatsapp_messages").select("delivery_status,status_timestamp").eq("meta_message_id",String(status.id)).maybeSingle();
            if(existingError)console.error("WhatsApp status lookup error",existingError);
            const deliveryRank:any={sent:1,delivered:2,read:3,failed:0};
            if(!existingError&&mapped&&existingStatus&&(mapped==="failed"?!["delivered","read"].includes(existingStatus.delivery_status):(deliveryRank[mapped]??0)>=(deliveryRank[existingStatus.delivery_status]??0))&&(!existingStatus.status_timestamp||Date.parse(statusTime)>=Date.parse(existingStatus.status_timestamp))){
              let statusQuery=supabase.from("whatsapp_messages").update(patch).eq("meta_message_id",String(status.id));statusQuery=existingStatus.delivery_status?statusQuery.eq("delivery_status",existingStatus.delivery_status):statusQuery.is("delivery_status",null);
              const {error:statusError}=await statusQuery;if(statusError)console.error("WhatsApp status save error",statusError);
            }
          }

          const contacts = value?.contacts ?? [];

          const contactNames = new Map<string, string>();

          for (const contact of contacts) {
            if (contact?.wa_id) {
              contactNames.set(
                String(contact.wa_id),
                contact?.profile?.name ?? ""
              );
            }
          }

          for (const message of value?.messages ?? []) {
            if (!message?.id || !message?.from) continue;

            const waId = String(message.from);

            const messageTime = message.timestamp
              ? new Date(
                  Number(message.timestamp) * 1000
                ).toISOString()
              : new Date().toISOString();

            let messageText: string | null = null;

            if (message.type === "text") {
              messageText = message.text?.body ?? null;
            } else if (message.type === "button") {
              messageText = message.button?.text ?? null;
            } else if (message.type === "interactive") {
              messageText =
                message.interactive?.button_reply?.title ??
                message.interactive?.list_reply?.title ??
                null;
            }

            if (messageText && /^(STOP|UNSUBSCRIBE|CANCEL|END|QUIT)\b/i.test(messageText.trim())) {
              const {error:optoutError}=await supabase.rpc("broadcast_record_optout",{p_phone:waId,p_reason:"Customer opt-out message"});
              if(optoutError)console.error("Broadcast opt-out save error",optoutError);
            }

            const { error: contactError } = await supabase
              .from("whatsapp_contacts")
              .upsert(
                {
                  wa_id: waId,
                  phone_number: waId,
                  profile_name:
                    contactNames.get(waId) || null,
                  last_message_at: messageTime,
                  updated_at: new Date().toISOString(),
                },
                {
                  onConflict: "wa_id",
                }
              );

            if (contactError) {
              console.error(
                "WhatsApp contact save error:",
                contactError
              );
            }

            const { error: messageError } = await supabase
              .from("whatsapp_messages")
              .upsert(
                {
                  meta_message_id: String(message.id),
                  wa_id: waId,
                  direction: "inbound",
                  message_type:
                    message.type ?? "unknown",
                  message_text: messageText,
                  message_timestamp: messageTime,
                  raw_payload: message,
                },
                {
                  onConflict: "meta_message_id",
                  ignoreDuplicates: true,
                }
              );

            if (messageError) {
              console.error(
                "WhatsApp message save error:",
                messageError
              );
            } else {
              try {
                const { data: cfg } = await supabase.from("push_config_private").select("internal_token").eq("id", true).single();
                if (cfg?.internal_token) {
                  await fetch("https://cjwxirpwzluynymwjzxl.supabase.co/functions/v1/push-new-lead", {
                    method: "POST",
                    headers: {"Content-Type":"application/json","x-fsp-push-token":cfg.internal_token},
                    body: JSON.stringify({
                      notification_type:"whatsapp_message",
                      full_name: contactNames.get(waId) || waId,
                      mobile_number: waId,
                      lead_source: "WhatsApp",
                      message_text: messageText || (message.type ? "[" + message.type + "]" : "New message")
                    })
                  });
                }
              } catch (pushError) {
                console.error("WhatsApp push notification error:", pushError);
              }
            }
          }
        }
      }

      return new Response(
        "EVENT_RECEIVED",
        { status: 200 }
      );

    } catch (error) {
      console.error(
        "Invalid WhatsApp webhook payload:",
        error
      );

      return new Response(
        "Bad Request",
        { status: 400 }
      );
    }
  }

  return new Response(
    "Method Not Allowed",
    { status: 405 }
  );
});
