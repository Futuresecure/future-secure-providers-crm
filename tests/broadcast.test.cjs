const fs=require('fs'),vm=require('vm'),{stripTypeScriptTypes}=require('node:module'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
const owner='4bd1c093-0912-4e63-a062-21d8fd759357';
class DB{
 constructor(){this.tables={broadcast_settings:[{id:true,send_enabled:false,mode:'test'}],broadcast_campaigns:[],broadcast_recipients:[],broadcast_optins:[],broadcast_optouts:[],whatsapp_messages:[],whatsapp_contacts:[],whatsapp_automation_queue:[]};this.next=1}
 from(t){return new Query(this,t)}
 async rpc(name,p){if(name==='broadcast_record_optout'){this.tables.broadcast_optouts.push({wa_id:p.p_phone,reason:p.p_reason});this.tables.broadcast_optins.filter(x=>x.wa_id===p.p_phone).forEach(x=>x.revoked_at=new Date().toISOString());this.tables.broadcast_recipients.filter(x=>x.wa_id===p.p_phone&&x.status==='pending').forEach(x=>x.status='skipped')}return {error:null}}
}
class Query{
 constructor(db,t){this.db=db;this.t=t;this.filters=[];this.op='read';this.options={};this.max=Infinity}
 eq(k,v){this.filters.push(x=>x[k]===v);return this}in(k,v){this.filters.push(x=>v.includes(x[k]));return this}is(k,v){this.filters.push(x=>(x[k]??null)===v);return this}lte(k,v){this.filters.push(x=>x[k]<=v);return this}lt(k,v){this.filters.push(x=>x[k]<v);return this}order(){return this}limit(n){this.max=n;return this}
 select(cols,opts={}){this.options=opts;return this}update(p){this.op='update';this.p=p;return this}insert(p){this.op='insert';this.p=p;return this}upsert(p,o){this.op='upsert';this.p=p;this.upOpts=o;return this}delete(){this.op='delete';return this}
 single(){this.one=true;return this}maybeSingle(){this.one=true;return this}
 then(res,rej){return Promise.resolve().then(()=>this.run()).then(res,rej)}
 run(){let rows=this.db.tables[this.t]||=[];let found=rows.filter(x=>this.filters.every(f=>f(x))).slice(0,this.max);if(this.op==='update')found.forEach(x=>Object.assign(x,this.p));if(this.op==='delete')this.db.tables[this.t]=rows.filter(x=>!found.includes(x));if(['insert','upsert'].includes(this.op)){found=[];for(const p of Array.isArray(this.p)?this.p:[this.p]){const keys=this.upOpts?.onConflict?.split(',')||['id'];let old=this.op==='upsert'?rows.find(x=>keys.every(k=>x[k]===p[k])):undefined;if(!old){old={id:'row'+this.db.next++,attempts:0,status:'draft',revoked_at:null,send_mode:'live',...p};rows.push(old)}else if(!this.upOpts?.ignoreDuplicates)Object.assign(old,p);found.push(old)}}return {data:this.options.head?null:this.one?(found[0]?structuredClone(found[0]):null):structuredClone(found),count:found.length,error:null}}
}
function load(file,db,user=owner,secret=true,fetcher){let handler;const env={SUPABASE_URL:'https://test.invalid',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service',WHATSAPP_ACCESS_TOKEN:'prod',...(secret?{WHATSAPP_APP_SECRET:'test-secret'}:{})};const context={console:{log(){},error(){}},URL,Request,Response,Date,Set,Map,TextEncoder,crypto:webcrypto,AbortSignal,Deno:{env:{get:k=>env[k]},serve:f=>handler=f},createClient:(url,key)=>key==='anon'?{auth:{getUser:async()=>({data:{user:user?{id:user}:null},error:null})}}:db,fetch:fetcher||(async()=>Response.json({data:[{name:'marketing',language:'en_US',status:'APPROVED',category:'MARKETING',components:[{type:'BODY',text:'Hello {{1}} {{2}} {{2}}'}]}]}))};vm.createContext(context);vm.runInContext(stripTypeScriptTypes(fs.readFileSync(file,'utf8').replace(/^import .*;$/gm,'')),context);return {handler,context}}
async function api(app,body){const r=await app.handler(new Request('https://test.invalid',{method:'POST',headers:{authorization:'Bearer test','content-type':'application/json'},body:JSON.stringify(body)}));return {status:r.status,body:await r.json()}}
function seeded(){const db=new DB;db.tables.broadcast_campaigns.push({id:'campaign',created_by:owner,status:'scheduled',send_mode:'test',scheduled_at:new Date(Date.now()-1000).toISOString(),template_name:'hello_world',template_language:'en_US'});db.tables.broadcast_recipients.push({id:'recipient',campaign_id:'campaign',wa_id:'919585905905',status:'pending',attempts:0,display_name:'Stalin'});db.tables.broadcast_optins.push({wa_id:'919585905905',revoked_at:null});return db}
let checks=0;function ok(v){assert(v);checks++}
(async()=>{
 let db=new DB,app=load('backend/broadcast-manage.ts',db,null);ok((await api(app,{action:'config'})).status===401);
 app=load('backend/broadcast-manage.ts',db,'other-user');ok((await api(app,{action:'optin_list'})).status===403);
 app=load('backend/broadcast-manage.ts',db);ok((await api(app,{action:'recipients',campaign_id:'missing'})).status===404);
 const create={action:'create',title:'Test',template_name:'marketing',language:'en_US',template_variables:{'2':'detail'},request_id:'00000000-0000-4000-8000-000000000001'};
 const one=await api(app,create),two=await api(app,create);ok(one.body.campaign.id===two.body.campaign.id&&db.tables.broadcast_campaigns.length===1);
 const id=one.body.campaign.id;db.tables.broadcast_optins.push({wa_id:'919585905905',consent_at:new Date().toISOString(),consent_source:'crm_manual',consent_reference:'test',revoked_at:null});
 const recipients={action:'recipients',campaign_id:id,recipients:[{phone:'9585905905'},{phone:'+91 95859 05905'}]};await api(app,recipients);await api(app,recipients);ok(db.tables.broadcast_recipients.length===1);
 ok((await api(app,{action:'approve',campaign_id:id})).status===409);
 db.tables.broadcast_settings[0]={id:true,send_enabled:true,mode:'live'};app=load('backend/broadcast-manage.ts',db,owner,false);ok((await api(app,{action:'approve',campaign_id:id})).status===409);
 app=load('backend/broadcast-manage.ts',db);ok((await api(app,{action:'approve',campaign_id:id,scheduled_at:'bad'})).status===400);ok((await api(app,{action:'approve',campaign_id:id})).status===200);ok((await api(app,{action:'approve',campaign_id:id})).status===409);
 await api(app,{action:'optout_add',phone:'9585905905'});ok(db.tables.broadcast_recipients[0].status==='skipped'&&!!db.tables.broadcast_optins[0].revoked_at);
 for(const mode of ['success','timeout','optout','future','cancelled','not-test-recipient','permanent','stale']){
  db=seeded();let sends=0;const fetcher=async(url,options)=>{if(!url.endsWith('/messages'))return Response.json({verified_name:'Test Number',display_phone_number:'+1 555-183-0040'});sends++;const p=JSON.parse(options.body);ok(p.to==='919585905905');if(mode==='timeout')throw Error('timeout');if(mode==='permanent')return Response.json({error:{message:'not allowed'}},{status:400});return Response.json({messages:[{id:'wamid.test'}]})};
  if(mode==='optout')db.tables.broadcast_optouts.push({wa_id:'919585905905'});if(mode==='future')db.tables.broadcast_campaigns[0].scheduled_at=new Date(Date.now()+60000).toISOString();if(mode==='cancelled')db.tables.broadcast_campaigns[0].status='cancelled';if(mode==='not-test-recipient')db.tables.broadcast_recipients[0].wa_id='919363705905';if(mode==='stale'){db.tables.broadcast_recipients[0].status='queued';db.tables.broadcast_recipients[0].claimed_at=new Date(Date.now()-700000).toISOString()}
  const loaded=load('backend/whatsapp-webhook.ts',db,owner,true,fetcher);await loaded.context.processBroadcastQueue(db,'test',['campaign']);await loaded.context.processBroadcastQueue(db,'test',['campaign']);
  ok(sends===(['success','timeout','permanent'].includes(mode)?1:0));ok(db.tables.broadcast_recipients[0].status===(mode==='success'?'sent':['timeout','permanent','stale'].includes(mode)?'failed':['optout','not-test-recipient'].includes(mode)?'skipped':'pending'));
 }
 db=seeded();let calls=0;app=load('backend/whatsapp-webhook.ts',db,owner,true,async()=>{calls++;throw Error('must not fetch')});await app.context.processBroadcastQueue(db,'prod');ok(calls===0);
 db.tables.broadcast_settings[0]={id:true,send_enabled:true,mode:'live'};app=load('backend/whatsapp-webhook.ts',db,owner,false,async()=>{calls++;throw Error('must not fetch')});await app.context.processBroadcastQueue(db,'prod');ok(calls===0);
 // Signed Meta events update reports and reject forged callbacks. Existing GET verification stays valid.
 db=seeded();Object.assign(db.tables.broadcast_recipients[0],{status:'sent',meta_message_id:'wamid.test'});db.tables.whatsapp_messages.push({meta_message_id:'wamid.test'});app=load('backend/whatsapp-webhook.ts',db);
 const event=status=>JSON.stringify({entry:[{changes:[{field:'messages',value:{statuses:[{id:'wamid.test',status,timestamp:'1791454843'}]}}]}]});
 const signed=async raw=>{const key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode('test-secret'),{name:'HMAC',hash:'SHA-256'},false,['sign']);return 'sha256='+Buffer.from(await webcrypto.subtle.sign('HMAC',key,new TextEncoder().encode(raw))).toString('hex')};
 const raw=event('read');ok((await app.handler(new Request('https://test.invalid',{method:'POST',body:raw}))).status===403);
 for(const status of ['delivered','read','sent','failed']){const raw=event(status);ok((await app.handler(new Request('https://test.invalid',{method:'POST',body:raw,headers:{'x-hub-signature-256':await signed(raw)}}))).status===200)}
 ok(db.tables.broadcast_recipients[0].status==='read'&&!!db.tables.broadcast_recipients[0].read_at);ok(db.tables.whatsapp_messages[0].delivery_status==='read');
 ok((await app.handler(new Request('https://test.invalid?hub.mode=subscribe&hub.verify_token=fsp_meta_webhook_2026&hub.challenge=challenge'))).status===200);
 console.log(JSON.stringify({checks,passed:true}));
})().catch(e=>{console.error(e);process.exitCode=1});
