// Server-side OAuth / quote-entitlement health check; never returns credentials.
const env=name=>globalThis.Netlify?.env?.get(name)??process.env[name];
const respond=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
export default async request=>{
  if(request.method!=='GET')return respond({status:'method_not_allowed'},405);
  const clientSecret=env('TASTY_CLIENT_SECRET'),refreshToken=env('TASTY_REFRESH_TOKEN');
  if(!clientSecret||!refreshToken)return respond({status:'awaiting_credentials',required:['TASTY_CLIENT_SECRET','TASTY_REFRESH_TOKEN']});
  try{
    const auth=await fetch('https://api.tastyworks.com/oauth/token',{
      method:'POST',headers:{'user-agent':'strategy-signals/1.0','content-type':'application/json','accept':'application/json'},
      body:JSON.stringify({grant_type:'refresh_token',refresh_token:refreshToken,client_secret:clientSecret}),
      signal:AbortSignal.timeout(10000)
    });
    if(!auth.ok)return respond({status:'oauth_failed',httpStatus:auth.status});
    const payload=await auth.json();
    if(!payload.access_token)return respond({status:'oauth_response_invalid'});
    const quote=await fetch('https://api.tastyworks.com/api-quote-tokens',{
      headers:{authorization:'Bearer '+payload.access_token,'user-agent':'strategy-signals/1.0'},
      signal:AbortSignal.timeout(10000)
    });
    if(!quote.ok)return respond({status:'oauth_ok_quote_access_failed',httpStatus:quote.status});
    const data=(await quote.json()).data;
    if(!data?.token||!data['dxlink-url'])return respond({status:'quote_response_invalid'});
    return respond({status:'oauth_and_dxlink_entitlement_ready',note:'Credentials work; historical candles and adjusted factors still require verification.'});
  }catch(e){
    return respond({status:'connection_error',note:'Provider could not be reached'},503);
  }
};

// Rate-limit public health checks so repeated calls cannot exhaust OAuth or DXLink quotas.
// The client never sees a bearer token, refresh token, or client secret.
export const config = {
  path: ["/api/provider-check", "/.netlify/functions/provider-check"],
  rateLimit: { windowLimit: 3, windowSize: 60, aggregateBy: ["ip", "domain"] }
};
