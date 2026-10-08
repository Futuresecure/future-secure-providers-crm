import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

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

const VERIFY_TOKEN = "fsp_meta_webhook_2026";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

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
          const tr=await metaFetch("https://graph.facebook.com/v23.0/922433197569331/message_templates?fields=name,status,language,components&limit=100",{headers:{Authorization:"Bearer "+metaToken}});const tj=await tr.json();const tpl=(tj.data??[]).find((x:any)=>x.name===templateName&&x.status==="APPROVED");
          if(!tpl){await supabase.from("whatsapp_automation_queue").update({status:"failed",attempts:(job.attempts??0)+1,last_error:"Template not approved"}).eq("id",job.id);failed++;continue;}
          const payload={messaging_product:"whatsapp",to,type:"template",template:{name:templateName,language:{code:tpl.language},components:[{type:"body",parameters:params.map(x=>({type:"text",text:x}))}]}};
          const mr=await metaFetch("https://graph.facebook.com/v23.0/1248446071686225/messages",{method:"POST",headers:{Authorization:"Bearer "+metaToken,"Content-Type":"application/json"},body:JSON.stringify(payload)});const mj=await mr.json();
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
        return Response.json({ok:true,processed:(jobs??[]).length,sent,failed});
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
            if (!status?.id || !["sent","delivered","read","failed"].includes(String(status.status))) continue;
            const seconds=Number(status.timestamp);
            const statusTime=Number.isFinite(seconds)&&seconds>0?new Date(seconds*1000).toISOString():new Date().toISOString();
            const {error:statusError}=await supabase.rpc("broadcast_apply_delivery",{
              p_meta_id:String(status.id),p_status:String(status.status),p_at:statusTime,
              p_error:status.status==="failed"?String(status.errors?.[0]?.title||status.errors?.[0]?.message||"Delivery failed").slice(0,500):null
            });
            if(statusError)throw statusError;
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
                  await metaFetch("https://cjwxirpwzluynymwjzxl.supabase.co/functions/v1/push-new-lead", {
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

