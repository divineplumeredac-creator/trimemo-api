import test from 'node:test';
import assert from 'node:assert/strict';
import estimate from '../api/estimate-project.js';

process.env.NODE_ENV='test';
process.env.SUPABASE_URL='https://database.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY='fake';
process.env.TRIMEMO_CLAUDE_API_KEY='fake-claude-key';
process.env.TRIMEMO_PRICING_SECRET='fake-pricing-secret';
const originalFetch=globalThis.fetch;
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
function mockResponse(){return {headers:{},setHeader(k,v){this.headers[k]=v},status(code){this.statusCode=code;return this},json(body){this.body=body;return this},end(){return this}}}
function request(){return {method:'POST',headers:{'x-vercel-ip-country':'BJ','x-trimemo-client-token':'account-token'},body:{project:{projectId:'test-project',sujet:'Sujet fictif',pages:30,niveau:'Licence',typeDoc:'Mémoire',files:[]}}}}
function installMock(replies){let calls=[];globalThis.fetch=async (url,init={})=>{url=String(url);if(url.includes('/auth/v1/user'))return json({id:'user-a'});if(url.includes('trimemo_client_projects?'))return json([{project_id:'test-project'}]);if(url.includes('trimemo_project_state?'))return json([{owner_id:'user-a'}]);if(url.includes('database.invalid'))return json([]);if(url.includes('api.anthropic.com')){calls.push(JSON.parse(init.body));return json(replies[Math.min(calls.length-1,replies.length-1)])}throw new Error('Unexpected endpoint')};return calls}
const valid={id:'fake',stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({complexity:'moyenne',reasons:['Méthode'],detectedRequirements:[]})}],usage:{input_tokens:1,output_tokens:1}};
const incomplete={...valid,stop_reason:'max_tokens'};
test('an incomplete response is retried without changing project data',async()=>{const calls=installMock([incomplete,valid]);try{let res=mockResponse();await estimate(request(),res);assert.equal(res.statusCode,200);assert.ok(res.body.estimate.pricingQuoteToken);assert.equal(calls.length,2);assert.equal(calls[0].max_tokens,2000);assert.equal(calls[1].messages[0].content[0].text,calls[0].messages[0].content[0].text)}finally{globalThis.fetch=originalFetch}});
test('two malformed responses fail safely without inventing a quote',async()=>{const calls=installMock([{...valid,content:[{type:'text',text:'JSON invalide'}]}]);try{let res=mockResponse();await estimate(request(),res);assert.equal(res.statusCode,502);assert.equal(res.body.estimate,undefined);assert.equal(calls.length,2)}finally{globalThis.fetch=originalFetch}});
