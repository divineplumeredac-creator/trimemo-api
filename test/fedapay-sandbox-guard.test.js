import test from 'node:test';
import assert from 'node:assert/strict';
import { sandboxRepository } from '../lib/fedapay-sandbox-repository.js';
import handler from '../api/fedapay-sandbox.js';
import webhook from '../api/fedapay-sandbox-webhook.js';

function res(){return {code:null,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(b){this.body=b;return this;},end(){return this;}};}
test('la base Supabase de production ne peut pas servir aux tests de paiement',()=>{
 assert.throws(()=>sandboxRepository({url:'https://myzaepudoqnqnvpbopoy.supabase.co',serviceKey:'x',testProjectRef:'myzaepudoqnqnvpbopoy'}),{status:503});
 assert.throws(()=>sandboxRepository({url:'https://myzaepudoqnqnvpbopoy.supabase.co',serviceKey:'x',testProjectRef:'abcdefghijklmnopqrst'}),{status:503});
});
test('les routes de test ne fonctionnent pas en production',async()=>{
 const previous=process.env.VERCEL_ENV,enabled=process.env.FEDAPAY_SANDBOX_ENABLED;
 try {process.env.VERCEL_ENV='production';process.env.FEDAPAY_SANDBOX_ENABLED='true';let r=res();await handler({method:'POST',headers:{},body:{action:'create'}},r);assert.equal(r.code,404);r=res();await webhook({method:'POST',headers:{}},r);assert.equal(r.code,404);}
 finally {if(previous===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=previous;if(enabled===undefined)delete process.env.FEDAPAY_SANDBOX_ENABLED;else process.env.FEDAPAY_SANDBOX_ENABLED=enabled;}
});

test('le webhook rejette une signature falsifiée avant tout accès externe',async()=>{
 const {Readable}=await import('node:stream'); const oldEnv=process.env.VERCEL_ENV,oldEnabled=process.env.FEDAPAY_SANDBOX_ENABLED,oldSecret=process.env.FEDAPAY_SANDBOX_WEBHOOK_SECRET,oldFetch=globalThis.fetch;
 try {process.env.VERCEL_ENV='preview';process.env.FEDAPAY_SANDBOX_ENABLED='true';process.env.FEDAPAY_SANDBOX_WEBHOOK_SECRET='test-secret';globalThis.fetch=async()=>{throw Error('Un appel externe ne doit pas se produire')};const req=Readable.from([Buffer.from('{"name":"transaction.approved"}')]);req.method='POST';req.headers={'x-fedapay-signature':'t=1,s=bad'};const r=res();await webhook(req,r);assert.equal(r.code,401);}
 finally {globalThis.fetch=oldFetch;for(const [key,value] of [['VERCEL_ENV',oldEnv],['FEDAPAY_SANDBOX_ENABLED',oldEnabled],['FEDAPAY_SANDBOX_WEBHOOK_SECRET',oldSecret]])if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
