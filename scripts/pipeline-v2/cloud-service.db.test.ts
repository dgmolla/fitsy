import { randomUUID } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { latLngToCell } from 'h3-js';
import { assertTestDatabase } from '../lib/test-database-guard';
import { CLOUD_RUN_PREFIX } from './cloud-budget';
import { SharedServiceBudget } from './service-budget';
import { SharedUeRateLimiter } from './ue-rate-limiter';

const suite = process.env['POSTGRES_PRISMA_URL'] ? describe : describe.skip;
suite('real cloud service/control CLI, PostgreSQL queue and limiter with provider HTTP fixtures', () => {
  const db = new PrismaClient(), root = resolve(__dirname,'../..');
  const hexIds = [34.05,34.08].map(lat=>latLngToCell(lat,-118.25,7));
  const children = new Map<ChildProcess,Promise<{ code:number|null; signal:string|null; stderr:string }>>();
  let directory:string, runId:string, restaurantIds:string[];
  const events = () => {
    const path = join(directory,'events.jsonl');
    return existsSync(path) ? readFileSync(path,'utf8').split('\n').slice(0,-1).filter(Boolean).map(line=>JSON.parse(line) as { type:string }) : [];
  };
  async function until<T>(read:()=>Promise<T>, ready:(value:T)=>boolean):Promise<T> {
    const end = Date.now()+15_000;
    while (Date.now()<end) { const value=await read(); if (ready(value)) return value; await new Promise(resolve=>setTimeout(resolve,25)); }
    throw new Error('Cloud service did not reach the expected checkpoint');
  }
  async function freePort():Promise<number> {
    const socket=createServer(); await new Promise<void>(accept=>socket.listen(0,'127.0.0.1',accept)); // loopback test fixture
    const port=(socket.address() as { port:number }).port; await new Promise<void>(accept=>socket.close(()=>accept())); return port;
  }
  async function worker(pause?:'ue'|'jev') {
    const port=await freePort(), url='http://127.0.0.1:'+port; // loopback test fixture
    const child=spawn(process.execPath,['--require',join(root,'scripts/pipeline-v2/cloud-http-fixture.cjs'),'--import','tsx','scripts/pipeline-cloud-worker.ts'],{
      cwd:root,stdio:['ignore','pipe','pipe'],env:{ PATH:process.env.PATH,HOME:process.env.HOME,PORT:String(port),
        PIPELINE_DATABASE_URL:assertTestDatabase(process.env['POSTGRES_PRISMA_URL']),TYPESAFE_API_KEY:'fixture-private-key',
        V2_TEST_REAL_DATABASE:'1',V2_TEST_EVENTS:join(directory,'events.jsonl'),...(pause?{ CLOUD_TEST_PAUSE:pause }: {}) },
    });
    let stdout='',stderr=''; child.stdout!.on('data',data=>{ stdout+=String(data); }); child.stderr!.on('data',data=>{ stderr+=String(data); });
    const done=new Promise<{ code:number|null;signal:string|null;stderr:string }>(accept=>child.on('close',(code,signal)=>accept({code,signal,stderr})));
    children.set(child,done);
    await until(async()=>stdout,value=>value.includes('cloud_worker_ready'));
    return { child,done,url };
  }
  function start(url:string,budget='0.02') {
    const result=spawnSync(process.execPath,['--import','tsx','scripts/pipeline-v2/cloud-control.ts','start','--url='+url,
      '--run-id='+runId,'--max-hexes=1','--budget-usd='+budget,...hexIds.map(hex=>'--hex-id='+hex)],{
      cwd:root,encoding:'utf8',timeout:10_000,env:{ PATH:process.env.PATH,HOME:process.env.HOME },
    });
    expect(result.status).toBe(0); expect(result.stderr).toBe(''); return JSON.parse(result.stdout) as { runId:string };
  }
  async function state() {
    const [row]=await db.$queryRaw<{ status:string; reserved:number }[]>`SELECT status,reserved_usd::float8 AS reserved FROM public.pipeline_runs WHERE run_id=${CLOUD_RUN_PREFIX+runId}`;
    return row;
  }
  beforeEach(async()=>{
    directory=mkdtempSync(join(tmpdir(),'cloud-service-')); runId='service-'+randomUUID(); restaurantIds=[];
    await db.$executeRaw`DELETE FROM public.pipeline_paid_requests`; await db.$executeRaw`DELETE FROM public.pipeline_service_days`;
    await new SharedServiceBudget(db).configure('jev',5,100000); await new SharedUeRateLimiter(db).configure(10);
    for (const [i,hex] of hexIds.entries()) {
      const id='cloud-'+runId+'-'+i; restaurantIds.push(id);
      await db.restaurant.create({data:{id,storeUuid:id,name:id,address:'Synthetic fixture',lat:34.05,lng:-118.25,
        source:'ue_feed',homeHex:hex,menuKind:'restaurant'}});
    }
  });
  afterEach(async()=>{
    for (const [child,done] of children) { if (child.exitCode===null && child.signalCode===null) child.kill('SIGKILL'); await done; }
    children.clear();
    await db.$executeRaw`DELETE FROM public.pipeline_paid_requests WHERE run_id=${CLOUD_RUN_PREFIX+runId}`;
    await db.hexJob.deleteMany({where:{runId:CLOUD_RUN_PREFIX+runId}});
    await db.pipelineCompletedHex.deleteMany({where:{runId:CLOUD_RUN_PREFIX+runId}});
    await db.$executeRaw`DELETE FROM public.pipeline_runs WHERE run_id=${CLOUD_RUN_PREFIX+runId}`;
    await db.restaurant.deleteMany({where:{id:{in:restaurantIds}}});
    await new SharedUeRateLimiter(db).configure(1); rmSync(directory,{recursive:true,force:true});
  });
  afterAll(()=>db.$disconnect());

  test('two replicas process one bounded CLI start via the shared rate limiter and atomic hex transaction',async()=>{
    const a=await worker(), b=await worker(), before=await new SharedUeRateLimiter(db).state();
    expect((await fetch(a.url+'/readyz')).status).toBe(200); expect((await fetch(b.url+'/healthz')).status).toBe(200);
    expect((await fetch(a.url+'/runs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId})})).status).toBe(400);
    expect((await fetch(a.url+'/runs',{method:'POST',headers:{'Content-Type':'text/plain'},
      body:JSON.stringify({runId,hexIds,maxHexes:1,budgetUsd:0.02})})).status).toBe(400);
    expect(await state()).toBeUndefined();
    start(a.url); await until(state,value=>value?.status==='completed');
    expect(await db.hexJob.count({where:{runId:CLOUD_RUN_PREFIX+runId}})).toBe(1);
    expect(await db.pipelineCompletedHex.count({where:{runId:CLOUD_RUN_PREFIX+runId}})).toBe(1);
    expect(await db.menuItem.count({where:{restaurantId:restaurantIds[0]!}})).toBeGreaterThan(0);
    expect(await db.menuItem.count({where:{restaurantId:restaurantIds[1]!}})).toBe(0);
    expect(events().filter(event=>event.type==='jev_call')).toHaveLength(2);
    expect((await new SharedUeRateLimiter(db).state()).requests-before.requests).toBe(1n);
    start(b.url); expect(events().filter(event=>event.type==='jev_call')).toHaveLength(2);
    a.child.kill('SIGTERM'); b.child.kill('SIGTERM');
    expect(await a.done).toMatchObject({code:0,stderr:''}); expect(await b.done).toMatchObject({code:0,stderr:''});
  },30_000);
  test('fleet run budget stops before the second paid request, without a partial hex checkpoint',async()=>{
    const a=await worker(), b=await worker(); start(a.url,'0.000688128');
    await until(state,value=>value?.status==='budget_cap');
    expect(events().filter(event=>event.type==='jev_call')).toHaveLength(1);
    expect(await db.pipelineCompletedHex.count({where:{runId:CLOUD_RUN_PREFIX+runId}})).toBe(0);
    a.child.kill('SIGTERM'); b.child.kill('SIGTERM'); await Promise.all([a.done,b.done]);
  },30_000);
  test('SIGTERM aborts an unpaid provider call, releases its lease, and a replacement completes without waiting for expiry',async()=>{
    const a=await worker('ue'); start(a.url);
    await until(async()=>events(),value=>value.some(event=>event.type==='paused'));
    a.child.kill('SIGTERM'); expect(await a.done).toMatchObject({code:0,stderr:''});
    const [job]=await db.hexJob.findMany({where:{runId:CLOUD_RUN_PREFIX+runId}});
    expect(job).toMatchObject({status:'pending',attempts:0,leaseOwner:null,leaseExpiresAt:null});
    const replacement=await worker(); await until(state,value=>value?.status==='completed');
    replacement.child.kill('SIGTERM'); expect(await replacement.done).toMatchObject({code:0,stderr:''});
  },30_000);
  test('SIGTERM during paid transport retains the unknown reservation and parks work without a repeated paid call',async()=>{
    const a=await worker('jev'); start(a.url);
    await until(async()=>events(),value=>value.some(event=>event.type==='paused'));
    a.child.kill('SIGTERM'); expect(await a.done).toMatchObject({code:0,stderr:''});
    expect(await state()).toMatchObject({status:'failed'}); expect((await state())!.reserved).toBeGreaterThan(0);
    const replacement=await worker(); expect(events().filter(event=>event.type==='jev_call')).toHaveLength(1);
    expect(await db.pipelineCompletedHex.count({where:{runId:CLOUD_RUN_PREFIX+runId}})).toBe(0);
    replacement.child.kill('SIGTERM'); expect(await replacement.done).toMatchObject({code:0,stderr:''});
  },30_000);
});
