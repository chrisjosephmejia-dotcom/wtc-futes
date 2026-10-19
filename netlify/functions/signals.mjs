// Public read-only endpoint. No secrets, accounts, trades, or unverified signals returned.
const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const respond=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
const env=name=>globalThis.Netlify?.env?.get(name)??process.env[name];
export default async request=>{
  if(request.method!=='GET')return respond({error:'method_not_allowed'},405);
  const configured=!!env('TASTY_CLIENT_SECRET')&&!!env('TASTY_REFRESH_TOKEN');
  return respond({
    verified:false,status:configured?'data_backfill_pending':'awaiting_credentials',
    asOf:null,readOnly:true,provider:'tastytrade DXLink',
    hybrid:{verified:false,reason:'Historical QQQ candles and canonical King state not yet validated'},
    centurion:{verified:false,reason:'Adjusted five-factor histories and state machine not yet validated'}
  });
};
