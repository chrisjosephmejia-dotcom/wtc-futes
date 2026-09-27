declare const Netlify:any;

function cfg(){
  const apiKey=Netlify.env.get("RESEND_API_KEY");
  const to=Netlify.env.get("ALERT_EMAIL_TO");
  const from=Netlify.env.get("ALERT_EMAIL_FROM") || "WTC MNQ <onboarding@resend.dev>";
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

export async function sendSignalEmail(current:any){
  const alignment=`${current.frames["30m"].state}/${current.frames["15m"].state}/${current.frames["5m"].state}/${current.frames["1m"].state}`;
  const subject=current.signal==="BUY MNQ"?"MNQ BUY":"MNQ SELL";
  const contract=current.instrument?.symbol || "NQ";
  const text=[
    subject,
    `${contract}: $${current.price}`,
    `Score: ${current.score>0?"+":""}${current.score}/9`,
    `Alignment: ${alignment}`,
    `Reason: ${current.reason||"—"}`,
    `Source: ${current.source||"tastytrade DXLink / CME"}`,
    `Time: ${current.checkedAt||new Date().toISOString()}`,
    "Dashboard: https://wtc-futes.netlify.app/"
  ].join("\n");
  const stamp=(current.checkedAt||new Date().toISOString()).slice(0,16).replace(/[^0-9]/g,"");
  return send(subject,text,`mnq-${current.signal}-${stamp}`);
}

export async function sendTestEmail(){
  return send(
    "WTC MNQ email test",
    "Email alerts are working. Future BUY MNQ / SELL MNQ signal changes will be sent from the WTC Futes server.",
    `mnq-test-${Date.now()}`
  );
}
