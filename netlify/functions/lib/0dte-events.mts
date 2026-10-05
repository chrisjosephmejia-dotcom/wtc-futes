type EventRow={date:string;minuteCt:number;name:string;impact:"high"|"medium";source:string};

const FOMC=[
  "2026-10-28","2026-12-09",
  "2027-01-27","2027-03-17","2027-04-28","2027-06-09","2027-07-28","2027-09-15","2027-10-27","2027-12-08"
];

function parseDate(v:string){
  const m=v.match(/(\d{4})(\d{2})(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:null;
}
async function fetchBls(date:string){
  try{
    const r=await fetch("https://www.bls.gov/schedule/news_release/bls.ics",{headers:{"User-Agent":"wtc-0dte/1.0"}});
    if(!r.ok)return[] as EventRow[];
    const txt=await r.text(),out:EventRow[]=[];
    for(const b of txt.split("BEGIN:VEVENT").slice(1)){
      const raw=b.match(/DTSTART[^:]*:([^\r\n]+)/)?.[1]||"",d=parseDate(raw);
      if(d!==date)continue;
      const s=(b.match(/SUMMARY:([^\r\n]+)/)?.[1]||"").replace(/\\,/g,",").trim();
      if(/Employment Situation/i.test(s))out.push({date,minuteCt:450,name:"U.S. employment report",impact:"high",source:"BLS"});
      else if(/Consumer Price Index/i.test(s))out.push({date,minuteCt:450,name:"Consumer Price Index",impact:"high",source:"BLS"});
      else if(/Producer Price Index/i.test(s))out.push({date,minuteCt:450,name:"Producer Price Index",impact:"high",source:"BLS"});
      else if(/Job Openings and Labor Turnover/i.test(s))out.push({date,minuteCt:540,name:"JOLTS report",impact:"medium",source:"BLS"});
      else if(/Employment Cost Index/i.test(s))out.push({date,minuteCt:450,name:"Employment Cost Index",impact:"medium",source:"BLS"});
    }
    return out;
  }catch{return[] as EventRow[]}
}

export async function get0DteEventState(store:any,date:string,totalMinutes:number){
  const key=`calendar/${date}.json`;
  let events=await store.get(key,{type:"json"}).catch(()=>null) as EventRow[]|null;
  if(!Array.isArray(events)){
    events=await fetchBls(date);
    if(FOMC.includes(date))events.push({date,minuteCt:780,name:"Federal Reserve decision",impact:"high",source:"Federal Reserve"});
    await store.setJSON(key,events).catch(()=>{});
  }else if(FOMC.includes(date)&&!events.some(e=>e.name==="Federal Reserve decision")){
    events.push({date,minuteCt:780,name:"Federal Reserve decision",impact:"high",source:"Federal Reserve"});
  }
  const high=events.filter(e=>e.impact==="high").sort((a,b)=>a.minuteCt-b.minuteCt);
  const active=high.find(e=>totalMinutes>=e.minuteCt-10&&totalMinutes<=e.minuteCt+15)||null;
  const exitAhead=high.find(e=>totalMinutes>=e.minuteCt-5&&totalMinutes<e.minuteCt)||null;
  const next=high.find(e=>e.minuteCt>totalMinutes)||null;
  return {events,highImpactLockout:Boolean(active),active,forceExitEvent:exitAhead,nextHigh:next};
}
