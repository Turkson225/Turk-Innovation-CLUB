// Optional Cloudflare Worker: dedicated origin and real HTTP security headers.
// This is deployment source, not a claim that GitHub Pages applies these headers.
import {securityHeaders} from '../security-policy.js';
export async function handleRequest(request,env={},upstream=fetch){
 if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{...securityHeaders,Allow:'GET, HEAD'}});
 const base=new URL(env.ORIGIN_BASE||'https://turkson225.github.io/Turk-Innovation-CLUB/');
 if(base.protocol!=='https:'||base.hostname!=='turkson225.github.io'||base.pathname!=='/Turk-Innovation-CLUB/')throw Error('Unexpected SPACE upstream');
 const incoming=new URL(request.url),target=new URL('./'+incoming.pathname.replace(/^\//,''),base);
 if(!target.pathname.startsWith(base.pathname))return new Response('Not found',{status:404,headers:securityHeaders});
 target.search=incoming.search;
 // Never forward browser credentials, cookies, Host or arbitrary proxy headers.
 const headers=new Headers();for(const name of ['accept','if-none-match','if-modified-since']){const value=request.headers.get(name);if(value)headers.set(name,value);}
 let response;
 try{response=await upstream(target.href,{method:request.method,headers,redirect:'manual'});}
 catch{return new Response('SPACE is temporarily unavailable. Please retry.',{status:502,headers:securityHeaders});}
 const output=new Headers(response.headers);for(const [name,value] of Object.entries(securityHeaders))output.set(name,value);
 output.delete('set-cookie');
 const location=output.get('location');if(location){const next=new URL(location,target);if(next.origin===base.origin&&next.pathname.startsWith(base.pathname)){output.set('location',new URL('/'+next.pathname.slice(base.pathname.length)+next.search+next.hash,incoming.origin).href);}else return new Response('Unexpected upstream redirect',{status:502,headers:securityHeaders});}
 if((output.get('content-type')||'').includes('text/html')||incoming.search)output.set('cache-control','no-store');
 return new Response(request.method==='HEAD'?null:response.body,{status:response.status,headers:output});
}
export default {fetch(request,env){return handleRequest(request,env);}};
