function b64ToBytes(s){
  const p='='.repeat((4-s.length%4)%4);
  const b=atob((s+p).replace(/-/g,'+').replace(/_/g,'/'));
  return Uint8Array.from([...b].map(c=>c.charCodeAt(0)));
}

function sameBytes(a,b){
  if(!a||!b||a.length!==b.length)return false;
  for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;
  return true;
}

async function reconcilePushSubscription(){
  try{
    const sub=await self.registration.pushManager.getSubscription();
    if(!sub)return;
    const res=await fetch('/api/vapid-key',{cache:'no-store'});
    if(!res.ok)return;
    const {publicKey}=await res.json();
    if(!publicKey)return;
    const expected=b64ToBytes(publicKey);
    const actual=sub.options?.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
    if(!sameBytes(actual,expected)) await sub.unsubscribe();
  }catch(err){
    console.error('push subscription reconcile failed',err);
  }
}

self.addEventListener('install',event=>{
  self.skipWaiting();
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    await reconcilePushSubscription();
    await self.clients.claim();
  })());
});

self.addEventListener('push', event => {
  let data={};
  try { data=event.data ? event.data.json() : {}; }
  catch { data={body:event.data?.text()||'MNQ update'}; }
  const title=data.title||'WTC MNQ';
  const options={
    body:data.body||'',
    tag:data.tag||'wtc-mnq',
    renotify:true,
    requireInteraction:data.kind==='signal',
    data:{url:data.url||'/',signal:data.signal||null}
  };
  event.waitUntil(self.registration.showNotification(title,options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target=new URL(event.notification.data?.url||'/',self.location.origin).href;
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    for (const c of list) {
      if (c.url.startsWith(self.location.origin) && 'focus' in c) {
        c.navigate(target);
        return c.focus();
      }
    }
    return clients.openWindow ? clients.openWindow(target) : undefined;
  }));
});
