declare const Netlify:any;

function cfg(){
  const apiKey=Netlify.env.get("RESEND_API_KEY");
  const to=Netlify.env.get("ALERT_EMAIL_TO");
  const from=Netlify.env.get("ALERT_EMAIL_FROM") || "WTC MCL <onboarding@resend.dev>";
  if(!apiKey || !to) throw new Error("Email alert environment variables are missing");
  return {apiKey,to,from};
}

async function send(subject:string,text:string,idempotencyKey:string){
  const {apiKey,to,from}=cfg();
  const r=await fetch("https://api.resend.com/emails",{
    method:"POST",
    headers:{
      "Authorization":`Bearer ${apiKey}`,
      "Content-Type":"application/json",
      "Idempotency-Key":idempotencyKey
    },
    body:JSON.stringify({from,to:[to],subject,text})
  });
  const body=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(body?.message || body?.error || `Resend HTTP ${r.status}`);
  return body;
}

function subjectFor(currentSignal:any,previousSignal:any){
  if(currentSignal === "BUY MCL") return previousSignal === "SELL MCL" ? "MCL REVERSE → BUY" : "MCL BUY";
  if(currentSignal === "SELL MCL") return previousSignal === "BUY MCL" ? "MCL REVERSE → SELL" : "MCL SELL";
  if(previousSignal === "BUY MCL") return "MCL EXIT LONG";
  if(previousSignal === "SELL MCL") return "MCL EXIT SHORT";
  return "MCL WAIT";
}

export async function sendSignalEmail(current:any,previousSignal:any="WAIT"){
  const alignment=`${current.frames?.["30m"]?.state||"—"}/${current.frames?.["15m"]?.state||"—"}/${current.frames?.["5m"]?.state||"—"}/${current.frames?.["1m"]?.state||"—"}`;
  const subject=subjectFor(current.signal,previousSignal);
  const contract=current.instrument?.symbol || "MCL";
  const text=[
    subject,
    `${contract}: $${current.price}`,
    `Position state: ${current.signal||"WAIT"}`,
    `Raw setup signal: ${current.rawSignal||current.signal||"WAIT"}`,
    `Score: ${Number(current.score)>0?"+":""}${current.score}/9`,
    `Alignment: ${alignment}`,
    `Reason: ${current.reason||"—"}`,
    `Raw reason: ${current.rawReason||current.reason||"—"}`,
    `Strategy: ${current.strategyVersion||"WTC"}`,
    `Source: ${current.source||"tastytrade DXLink / NYMEX"}`,
    `Time: ${current.checkedAt||new Date().toISOString()}`,
    "Dashboard: https://wtc-futes.netlify.app/"
  ].join("\n");
  const stamp=(current.checkedAt||new Date().toISOString()).slice(0,16).replace(/[^0-9]/g,"");
  return send(subject,text,`mcl-${subject.replace(/[^a-z0-9]+/gi,"-").toLowerCase()}-${stamp}`);
}

export async function sendTestEmail(){
  return send(
    "WTC MCL email test",
    "Email alerts are working. WTC MCL V1 sends entries, reversals and true exits; ordinary raw WAIT flicker while a position is held does not alert.",
    `mcl-test-${Date.now()}`
  );
}
