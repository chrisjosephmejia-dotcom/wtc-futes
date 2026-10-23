import { getStore } from "@netlify/blobs";

export function store(name: string) {
  return getStore(name, { consistency: "strong" });
}
