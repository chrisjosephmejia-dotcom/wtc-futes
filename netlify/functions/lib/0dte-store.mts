import { getStore, getDeployStore } from "@netlify/blobs";

export function get0DteStore(){
  const context=(globalThis as any)?.Netlify?.context?.deploy?.context;
  return context==="production"
    ? getStore("wtc-0dte",{consistency:"strong"})
    : getDeployStore("wtc-0dte");
}
