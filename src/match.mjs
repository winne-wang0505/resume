export const degreeRank = { '不限':0,'高中':1,'专科':2,'本科':3,'硕士':4,'博士':5 };
export function evaluate(profile, prefs, job) {
  const skills=profile.skills.split(/[,，、\n]/).map(x=>x.trim().toLowerCase()).filter(Boolean);
  const required=job.skills||[];
  const matched=required.filter(x=>skills.some(s=>s.includes(x.toLowerCase())||x.toLowerCase().includes(s)));
  const missing=required.filter(x=>!matched.includes(x));
  const evidence=[]; const blockers=[]; const dims=[];
  const add=(name,value,weight,reason)=>{dims.push({name,value,weight});evidence.push(reason)};
  if(required.length)add('技能',Math.round(matched.length/required.length*100),35,`技能覆盖 ${matched.length}/${required.length}：${matched.join('、')||'暂无明确匹配'}`);
  if(job.degree && job.degree!=='不限') {const ok=(degreeRank[profile.degree]||0)>=(degreeRank[job.degree]||0);add('学历',ok?100:20,15,`岗位学历：${job.degree}；你的学历：${profile.degree}`);if(!ok)blockers.push('学历门槛未满足，请核实是否接受同等经验');}
  if(Number.isFinite(job.experience)){const years=Number(profile.years)||0;add('经验',job.experience===0?100:Math.min(100,Math.round(years/job.experience*100)),20,`要求 ${job.experience} 年经验，你填写 ${years} 年`);if(years<job.experience)blockers.push('经验年限低于岗位要求');}
  if(prefs.city && job.city)add('地点',job.city.includes(prefs.city)||prefs.city.includes(job.city)?100:20,10,`工作地点：${job.city}`);
  if(job.salaryMin && job.currency===prefs.currency){add('薪资',job.salaryMax>=Number(prefs.salary)?100:30,15,`月薪范围 ${job.salaryMin}–${job.salaryMax} ${job.currency}`);} 
  if(prefs.mode!=='不限'&&job.mode)add('工作方式',job.mode===prefs.mode?100:30,5,`工作方式：${job.mode}`);
  const total=dims.reduce((s,d)=>s+d.weight,0);
  const match=total?Math.round(dims.reduce((s,d)=>s+d.value*d.weight,0)/total):null;
  const confidence=Math.min(100,Math.round(total));
  // Readiness estimates preparedness against published requirements, never applicant ranking.
  const readiness=match===null?null:Math.max(0,Math.min(100,Math.round(match*.85+(profile.achievements.trim()?10:0)+(profile.experience.trim()?5:0))));
  const cost=job.applyMinutes||30;
  const value=match===null?null:Math.max(0,Math.min(100,Math.round(match*.65+readiness*.25+Math.max(0,100-cost)*.10-(blockers.length?15:0))));
  const expired=job.deadline&&new Date(job.deadline+'T23:59:59+08:00')<new Date();
  return {match,readiness,value,confidence,dims,evidence,missing,blockers,expired,advice:expired?'已截止，寻找同类岗位':match===null?'信息不足：先查看原始招聘公告':blockers.length?'先核实硬性门槛，再决定是否投入时间':value>=75?'优先投递：定制简历并准备岗位案例':value>=50?'选择性投递：补足缺失技能后再申请':'低优先级：建议调整方向或先补齐能力'};
}
export function safeURL(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:null}catch{return null}}
