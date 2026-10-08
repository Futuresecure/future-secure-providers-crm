const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const events={};let notifications=0,pending;
const context={URL,Response,self:{location:{origin:'https://futuresecureproviders.com'},registration:{scope:'https://futuresecureproviders.com/crm/',showNotification:async()=>{notifications++}},addEventListener:(n,f)=>{(events[n]??=[]).push(f)}},clients:{matchAll:async()=>[],openWindow:async url=>url},caches:{match:async key=>{assert.equal(key,'./index.html?v=55');return new Response('offline app')}},fetch:async()=>{throw Error('Offline')}};
vm.runInNewContext(fs.readFileSync('crm/service-worker.js','utf8'),context);
assert.equal(events.push.length,1);assert.equal(events.notificationclick.length,1);
(async()=>{
events.push[0]({data:{json:()=>({body:'test'})},waitUntil:p=>pending=p});await pending;assert.equal(notifications,1);
events.fetch[0]({request:{method:'GET',url:'https://futuresecureproviders.com/crm/',mode:'navigate'},respondWith:p=>pending=p});assert.equal(await(await pending).text(),'offline app');
events.notificationclick[0]({notification:{close(){},data:{url:'https://evil.example/'}},waitUntil:p=>pending=p});assert.equal(await pending,'https://futuresecureproviders.com/crm/');
console.log('PWA offline, single notification and safe navigation checks passed');
})().catch(e=>{console.error(e);process.exit(1)});
