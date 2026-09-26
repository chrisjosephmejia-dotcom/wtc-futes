import { getDeployStore, getStore } from "@netlify/blobs";

declare const Netlify: any;

export function store(name: string) {
  const context = Netlify?.context?.deploy?.context;
  if (context === "production") return getStore(name, { consistency: "strong" });
  return getDeployStore(name);
}
