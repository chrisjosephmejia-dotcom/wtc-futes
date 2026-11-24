/**
 * WTC Options Seller — read-only position reconciliation for WTC Options.
 * Do not infer an uncovered account from a missing or ambiguous spreadsheet row.
 * The Outcome column, not the (sometimes fee-only) BTC column, owns trade status.
 */
export type Position = {
  sourceRow: number; ticker: "SPY" | "QQQ"; account: string;
  opened: string | null; expiration: string | null; strike: number;
  contracts: number; entryPrice: number; netOpeningCredit: number;
  takeProfitBuybackPrice: number; outcome: "open"; staleExpiration: boolean;
};
const cleaned = (value: unknown) => String(value ?? "").trim();
function amount(value: unknown): number {
  const v=cleaned(value).replace(/[$,%\s,]/g,"");
  return v && Number.isFinite(Number(v)) ? Number(v) : NaN;
}
function iso(value: unknown): string | null {
  const v=cleaned(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m=v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const mm=Number(m[1]),dd=Number(m[2]),yy=Number(m[3]);
  const d=new Date(Date.UTC(yy,mm-1,dd));
  if (d.getUTCFullYear()!==yy||d.getUTCMonth()!==mm-1||d.getUTCDate()!==dd) return null;
  return [yy,String(mm).padStart(2,"0"),String(dd).padStart(2,"0")].join("-");
}
const round2=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
export function extractOpenCalls(
  values: unknown[][], ticker: "SPY"|"QQQ", account: string, todayChicago: string
) {
  const headerIndex=values.findIndex(r=>cleaned(r[0]).toLowerCase()==="ticker" && cleaned(r[1]).toLowerCase()==="strategy");
  if(headerIndex<0) throw new Error("Ledger header missing in "+account);
  const header=values[headerIndex].map(x=>cleaned(x).toLowerCase().replace(/[^a-z0-9]/g,""));
  const ix=(name:string)=>header.indexOf(name.replace(/[^a-z0-9]/g,""));
  const cols={ticker:ix("ticker"),strategy:ix("strategy"),opened:ix("opened"),exp:ix("exp"),strike:ix("strike"),
    contracts:ix("contracts"),premium:ix("premium"),net:ix("net premium"),outcome:ix("outcome")};
  if(Object.values(cols).some(i=>i<0)) throw new Error("Ledger columns changed in "+account);
  const openCalls:Position[]=[];
  const warnings:string[]=[];
  let latestEntryDate:string|null=null,latestEntryRow:number|null=null,matchingRows=0,ambiguous=0;
  for(let i=headerIndex+1;i<values.length;i++){
    const row=values[i];
    if(cleaned(row[cols.ticker]).toUpperCase()!==ticker||cleaned(row[cols.strategy]).toUpperCase()!=="CC") continue;
    matchingRows++;
    const date=iso(row[cols.opened]);
    if(date && (!latestEntryDate||date>=latestEntryDate)){latestEntryDate=date;latestEntryRow=i+1;}
    const status=cleaned(row[cols.outcome]).toLowerCase();
    if(["closed","rolled","assigned","expired","exercised"].includes(status)) continue;
    if(status!=="open" && status!=="opened" && status!=="active"){
      ambiguous++;
      warnings.push("Row "+(i+1)+": unrecognized/blank outcome; manually verify.");
      continue;
    }
    const expiration=iso(row[cols.exp]),strike=amount(row[cols.strike]);
    const contracts=amount(row[cols.contracts]),entryPrice=amount(row[cols.premium]);
    let netOpeningCredit=amount(row[cols.net]);
    if(!Number.isFinite(netOpeningCredit)) netOpeningCredit=NaN;
    if(!expiration||!date||!Number.isFinite(strike)||strike<=0||
       !Number.isInteger(contracts)||contracts<1||!Number.isFinite(entryPrice)||entryPrice<=0||
       !Number.isFinite(netOpeningCredit)){
      ambiguous++;
      warnings.push("Row "+(i+1)+": open trade has incomplete fields; manually verify.");
      continue;
    }
    const staleExpiration=expiration<todayChicago;
    if(staleExpiration) warnings.push("Row "+(i+1)+": OPEN trade has an elapsed expiration; verify before selling.");
    openCalls.push({sourceRow:i+1,ticker,account,opened:date,expiration,strike,contracts,
      entryPrice,netOpeningCredit,takeProfitBuybackPrice:round2(entryPrice*0.30),
      outcome:"open",staleExpiration});
  }
  const contractsOpen=openCalls.reduce((a,p)=>a+p.contracts,0);
  const safetyState=warnings.length ? "RECONCILE" : openCalls.length ? "OPEN_RECORDED" : "NO_OPEN_RECORDED";
  return {ticker,account,safetyState,openCalls,contractsOpen,matchingRows,latestEntryDate,latestEntryRow,
    warnings,needsManualConfirmation:true,source:"WTC Options / "+account};
}
