import { createHash } from "node:crypto";
// Deterministic hashed token vectors keep semantic retrieval local and reproducible.
export function embedText(text: string): number[] {
  const vector = Array.from({ length: 384 }, () => 0);
  const words = text.toLowerCase().match(/[a-z0-9+#.-]{2,}/g) ?? [];
  const features = [...words, ...words.slice(0,-1).map((word,i)=>`${word}_${words[i+1]}`)];
  for (const feature of features) { const digest=createHash("sha256").update(feature).digest(); vector[digest.readUInt32BE(0)%384]+=digest[4]%2?1:-1; }
  const norm=Math.sqrt(vector.reduce((sum,n)=>sum+n*n,0))||1;
  return vector.map(n=>Number((n/norm).toFixed(6)));
}
export const toPgVector=(vector:number[])=>`[${vector.join(",")}]`;
