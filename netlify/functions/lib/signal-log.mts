import { store } from "./storage.mjs";

const MNQ_DOLLARS_PER_POINT = 2;

function round(n:number, digits=2){
  const p=10**digits;
  return Math.round(n*p)/p;
}

function actionable(signal:any){
  return signal === "BUY MNQ" || signal === "SELL MNQ";
}

function alignment(current:any){
  const f=current?.frames || {};
  return ["30m","15m","5m","1m"].map(k=>f?.[k]?.state || "—").join("/");
}

function mnqContract(nqSymbol:any){
  const s=String(nqSymbol || "");
  return s.startsWith("/NQ") ? s.replace("/NQ","/MNQ") : "MNQ";
}

function closeTrade(trade:any,current:any){
  if(!Number.isFinite(Number(current?.price))) return trade;
  const exitPrice=Number(current.price);
  const side=trade.direction === "BUY MNQ" ? 1 : -1;
  const points=round((exitPrice-Number(trade.entryPrice))*side,2);
  const opened=Date.parse(trade.openedAt);
  const closed=Date.parse(current.checkedAt || new Date().toISOString());
  return {
    ...trade,
    status:"CLOSED",
    closedAt:current.checkedAt || new Date().toISOString(),
    exitPrice:round(exitPrice,2),
    exitSignal:current.signal || "WAIT",
    exitReason:current.reason || "SIGNAL ENDED",
    points,
    theoreticalPnl:round(points*MNQ_DOLLARS_PER_POINT,2),
    durationMinutes:Number.isFinite(opened)&&Number.isFinite(closed)?round(Math.max(0,(closed-opened)/60000),1):null,
  };
}

export async function updateSignalLog(current:any){
  const s=store("mnq-engine");
  const saved:any=await s.get("signal-log",{type:"json"}) || {};
  let trades:any[]=Array.isArray(saved.trades)?saved.trades:[];
  let openIndex=trades.findIndex(t=>t?.status === "OPEN");
  const isActionable=actionable(current?.signal);
  let changed=false;

  if(openIndex >= 0){
    const open=trades[openIndex];
    if(!isActionable || current.signal !== open.direction){
      const closed=closeTrade(open,current);
      if(closed?.status === "CLOSED"){
        trades[openIndex]=closed;
        changed=true;
      }
      openIndex=-1;
    }
  }

  const hasOpen=trades.some(t=>t?.status === "OPEN");
  if(isActionable && !hasOpen && Number.isFinite(Number(current?.price))){
    const now=current.checkedAt || new Date().toISOString();
    trades.unshift({
      id:`${now}-${current.signal}`,
      status:"OPEN",
      direction:current.signal,
      contract:mnqContract(current?.instrument?.symbol),
      sourceContract:current?.instrument?.symbol || "NQ",
      openedAt:now,
      entryPrice:round(Number(current.price),2),
      entryScore:Number.isFinite(Number(current.score))?Number(current.score):null,
      entryReason:current.reason || "—",
      alignment:alignment(current),
    });
    changed=true;
  }

  if(!changed && saved?.version >= 2) return saved;

  const now=new Date().toISOString();
  const result={
    version:2,
    multiplier:MNQ_DOLLARS_PER_POINT,
    createdAt:saved.createdAt || saved.updatedAt || now,
    updatedAt:now,
    retention:"permanent",
    trades,
  };
  await s.setJSON("signal-log",result);
  return result;
}

export function theoreticalMark(trade:any,price:any){
  if(!trade || !Number.isFinite(Number(price))) return null;
  const side=trade.direction === "BUY MNQ" ? 1 : -1;
  const points=round((Number(price)-Number(trade.entryPrice))*side,2);
  return {points,theoreticalPnl:round(points*MNQ_DOLLARS_PER_POINT,2)};
}

export { MNQ_DOLLARS_PER_POINT };
