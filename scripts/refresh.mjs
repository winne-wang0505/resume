import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {searchJobs} from '../src/search.mjs';
import {evaluate,safeURL} from '../src/match.mjs';
const role=process.env.JOB_ROLE||'数据分析';
const preferences={role,region:process.env.JOB_REGION||'全部',city:process.env.JOB_CITY||'',category:'全部',employment:'全职',mode:'不限',exclude:process.env.JOB_EXCLUDE||''};
if(!process.env.BRAVE_SEARCH_API_KEY){console.error('Missing BRAVE_SEARCH_API_KEY. Existing index preserved; no notification sent.');process.exit(1)}
const result=await searchJobs(preferences);
if(result.warnings.length){console.error('Incomplete source refresh; preserving previous index. '+result.warnings.join('; '));process.exit(1)}
await mkdir('public/data',{recursive:true});await writeFile('public/data/jobs.json',JSON.stringify(result,null,2)+'\n');
console.log(`Indexed ${result.jobs.length} search leads; not verified active vacancies.`);
// Personal matching is private and only read from an Actions secret, never written to the public index.
if(process.env.DAILY_RECIPIENT){
 if(!process.env.RESEND_API_KEY||!process.env.MAIL_FROM){console.error('Email requires RESEND_API_KEY and verified MAIL_FROM');process.exit(1)}
 const privateConfig=process.env.PRIVATE_MATCH_CONFIG?JSON.parse(process.env.PRIVATE_MATCH_CONFIG):{};
 const profile={degree:'本科',years:0,skills:'',experience:'',achievements:'',...privateConfig.profile};
 const prefs={city:'',currency:'CNY',salary:0,mode:'不限',...privateConfig.preferences};
 const rows=result.jobs.map(job=>({job,r:evaluate(profile,prefs,job)})).sort((a,b)=>(b.r.value??-1)-(a.r.value??-1)).slice(0,8);
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date());
 const text=`职向每日岗位线索 · ${day}\n以下是搜索发现的链接，未核实是否在招。未知要求不计算分数。分数不是录用概率。\n\n`+rows.map(({job,r})=>`${job.title} · ${job.region}\n匹配度 ${r.match??'信息不足'} / 准备度 ${r.readiness??'信息不足'} / 性价比 ${r.value??'信息不足'}\n${r.advice}\n${safeURL(job.url)||''}`).join('\n\n');
 const res=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`career-brief-${day}`},body:JSON.stringify({from:process.env.MAIL_FROM,to:[process.env.DAILY_RECIPIENT],subject:`职向 · ${day} 求职机会简报`,text}),signal:AbortSignal.timeout(20000)});
 if(!res.ok){console.error(`Email provider returned ${res.status}; no delivery claim made.`);process.exit(1)}
 console.log('Daily email accepted by provider (delivery not verified).');
}
