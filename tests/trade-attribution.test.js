const fs=require('fs'),vm=require('vm');
function lineWith(src,n){const h=src.split('\n').filter(l=>l.indexOf(n)>=0);if(h.length!==1)throw new Error('need 1, got '+h.length+' for '+n);return h[0];}
function block(src,a,b){const i=src.indexOf(a),j=src.indexOf(b);return src.slice(i,j);}
const impls=['builds/dev/popup.js','builds/commercial/popup.js'].map(f=>{
  const src=fs.readFileSync(f,'utf8');
  const ctx={console:{log(){}}};vm.createContext(ctx);
  const fn=vm.runInContext('(function(){'
    + block(src,'function _lpCustomerText(d){','\n\n// (v9.7.429/427) ONE definition')
    + ' return function(data){ var _ddCtxRaw=String((data&&data.context)||"");'
    + lineWith(src,'var _ddCtxMk  =') + lineWith(src,'var _ddCtxArc =')
    + ' var _ddRecent="";'
    + block(src,'        var _ddCustSpoke =','        // DISTANCE / REMOTE buyer')
    + ' return _ddTradeM?_ddTradeM[0]:null; }; })()',ctx);
  return {name:f.split('/')[1],fn};
});
let pass=0,fail=0;
function t(name,data,expect){
  const r=impls.map(i=>{try{return JSON.stringify(i.fn(data));}catch(e){return 'THREW: '+e.message;}});
  const ok=r.every(x=>x===r[0]) && r[0]===JSON.stringify(expect);
  if(ok){pass++;console.log('  ok   '+name);}
  else{fail++;console.log('  FAIL '+name);impls.forEach((i,n)=>console.log('        '+i.name+' -> '+r[n]));console.log('        expected '+JSON.stringify(expect));}
}
console.log('\nv9.7.539 — trade trigger must read the customer, not the agent\n');
console.log('must be SILENT on agent-authored trade copy:');
t('Codex case: agent KBB copy, customer asked availability',
  {lastInboundMsg:'Yes, is it still available?',hasCustomerReply:true,conversationBrief:'',
   context:'[AGENT] we can get a Kelley Blue Book value and a trade offer today'},null);
t('our OWN distance-buyer boilerplate, round-tripped as a note',
  {lastInboundMsg:'what time do you close',hasCustomerReply:true,conversationBrief:'',
   context:'[AGENT] I want to have your trade-in numbers ready before you arrive'},null);
t('agent voicemail offering an appraisal',
  {lastInboundMsg:'ok thanks',hasCustomerReply:true,conversationBrief:'',
   context:'[CALL NOTE] Left message - I can get you a trade value today'},null);
t('Woodfork: "Has trade-in: No" deal-builder blob',
  {lastInboundMsg:'Financing: ERROR via Hard Pull Has trade-in: No',hasCustomerReply:false,conversationBrief:'',context:''},null);

console.log('\nmust still FIRE on real customer evidence:');
t('customer asks in their own inbound',
  {lastInboundMsg:'what is my trade worth',hasCustomerReply:true,conversationBrief:'',context:''},'what is my trade worth');
t('[CUSTOMER]-tagged arc line',
  {lastInboundMsg:'ok',hasCustomerReply:true,conversationBrief:'',
   context:'[08/10/2026 9:00 AM] [CUSTOMER] whats my trade worth on the F-150'},'whats my trade worth');
t('call note attributing the ask to the customer (v9.7.362 capability)',
  {lastInboundMsg:'ok',hasCustomerReply:true,conversationBrief:'',
   context:'[CALL NOTE] he asked for a trade value on his F-150'},'trade value');
t('terse agent note, verb-initial customer state',
  {lastInboundMsg:'ok',hasCustomerReply:true,conversationBrief:'',
   context:'[CALL NOTE] wants a trade number before he drives up'},'trade number');
t('customer asks KBB by name',
  {lastInboundMsg:"can you run KBB on my truck",hasCustomerReply:true,conversationBrief:"",context:""},"KBB");
t('real ask AND agent copy in the same arc',
  {lastInboundMsg:'what would you give me for my trade',hasCustomerReply:true,conversationBrief:'',
   context:'[AGENT] we can get a Kelley Blue Book value'},'what would you give me');
console.log('\n'+(fail?'FAILED':'PASSED')+' — '+pass+' passed, '+fail+' failed\n');
process.exit(fail?1:0);
