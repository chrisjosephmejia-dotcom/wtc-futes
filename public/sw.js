self.addEventListener('push', event => {
  let data={};
  try { data=event.data ? event.data.json() : {}; } catch { data={body:event.data?.text()||'MNQ update'}; }
  const title=data.title||'WTC MNQ';
  const options={
    body:data.body||'',
    icon:'/icons/icon-192.png',
    badge:'/icons/icon-192.png',
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
    for (const c of list) { if (c.url.startsWith(self.location.origin) && 'focus' in c) { c.navigate(target); return c.focus(); } }
    return clients.openWindow ? clients.openWindow(target) : undefined;
  }));
});
