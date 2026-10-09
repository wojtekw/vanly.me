import https from 'node:https';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const live=process.env.VANLY_LIVE==='1',port=live?443:8443;
const ca=await fs.readFile(live?'/Library/Application Support/Vanly/public/vanly-root.crt':'/Users/wojtek/Library/Application Support/Vanly Portal/data/caddy/pki/authorities/local/root.crt');
const accounts=JSON.parse(await fs.readFile('.local/accounts.json','utf8'));
function request(host,path,method='GET',body,cookie,csrf,ip=live?'127.0.0.2':'127.0.0.1'){
 return new Promise((resolve,reject)=>{
  const origin=`https://${host}${live?'':':8443'}`, payload=body===undefined?undefined:JSON.stringify(body);
  const req=https.request({hostname:host,port,path:'/api/v1'+path,method,ca,lookup:(_,options,cb)=>options.all?cb(null,[{address:ip,family:4}]):cb(null,ip,4),headers:{Origin:origin,...(payload?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}:{}),...(cookie?{Cookie:cookie}:{}),...(csrf?{'x-csrf-token':csrf}:{})}},res=>{let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,data:JSON.parse(text)}));});
  req.on('error',reject);req.end(payload);
 });
}
for(const [host,email] of [['vanly.me.local','podroznik@vanly.local'],['owner.vanly.me.local','baltic@vanly.local'],['admin.vanly.me.local','operator@vanly.local']]){
 for(const ip of [live?'127.0.0.2':'127.0.0.1','192.168.188.44','192.168.188.41'])assert.equal((await request(host,'/health','GET',undefined,undefined,undefined,ip)).status,200);
 const a=accounts.find(a=>a.email===email);
 const login=await request(host,'/auth/login','POST',{email:a.email,password:a.password});assert.equal(login.status,201);
 const set=login.headers['set-cookie'][0];assert.ok(set.startsWith('__Host-vanly_session='));assert.ok(set.includes('Secure'));assert.ok(set.includes('HttpOnly'));assert.ok(set.includes('SameSite=Strict'));assert.ok(!set.includes('Domain='));
 const cookie=set.split(';')[0];const me=await request(host,'/auth/me','GET',undefined,cookie);assert.equal(me.data.user.email,email);
 assert.equal((await request(host,'/auth/logout','POST',undefined,cookie,'incorrect')).status,403);
 assert.equal((await request(host,'/auth/logout','POST',undefined,cookie,me.data.csrf)).status,201);
 console.log('PASS: '+host+' TLS on three interfaces; Secure host-only session and CSRF');
}
