// Read-only public HTTP checks. Does not create sessions or change Cloudflare.
import assert from "node:assert/strict";
const origin=process.env.EXTERNAL_WEB_ORIGIN??"https://anpr.vanmilligentechniek.com";
assert(new URL(origin).protocol==="https:","HTTPS required");
for(const path of ["/","/login"]){
 const response=await fetch(origin+path);assert.equal(response.status,200,path);
 const html=await response.text();assert(!/hmr-client|next-devtools|react-refresh/.test(html),"Development chunks still present");
 const paths=[...new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^" ]+)"/g)].map(m=>m[1]!))];
 assert(paths.length>0,"No static build assets found");
 for(const asset of paths){const r=await fetch(origin+asset,{headers:{origin,referer:origin+path,"sec-fetch-site":"same-origin"}});assert.equal(r.status,200,asset);assert(/javascript|text\/css|font\//.test(r.headers.get("content-type")??""),`Unexpected asset content type: ${asset}`);await r.arrayBuffer();}
 console.log(`PASS ${path}: 200, ${paths.length} production assets 200, no dev/HMR chunks`);
}
for(const [path,status] of [["/api/health",200],["/api/auth/me",401],["/api/auth/sessions",401],["/api/dashboard",401]] as const){
 const r=await fetch(origin+path);assert.equal(r.status,status,path);assert(r.headers.get("cache-control")?.includes("no-store"),"API must not be cached");console.log(`PASS ${path}: ${status}, no-store`);
}
