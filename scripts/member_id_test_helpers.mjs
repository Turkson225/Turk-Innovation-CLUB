export function node(extra={}){
 const listeners=new Map(),classes=new Set(),attributes=new Map();
 return {listeners,classes,attributes,children:[],dataset:{},style:{},parentElement:null,parentNode:null,hidden:false,isConnected:true,clientWidth:420,clientHeight:355,width:768,height:1080,textContent:'',
 classList:{add(...v){v.forEach(x=>classes.add(x));},remove(...v){v.forEach(x=>classes.delete(x));},contains:v=>classes.has(v),toggle(v,on){if(on)classes.add(v);else classes.delete(v);}},
 addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},removeEventListener(type,fn){listeners.get(type)?.delete(fn);},fire(type,event={}){for(const fn of [...(listeners.get(type)||[])])fn({type,...event});},
 setAttribute(k,v){attributes.set(k,String(v));},getAttribute:k=>attributes.get(k)??null,hasAttribute:k=>attributes.has(k),removeAttribute:k=>attributes.delete(k),
 append(...items){for(const child of items){child.parentElement=this;child.parentNode=this;this.children.push(child);}},appendChild(child){this.append(child);},
 remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(n=>n!==this);this.parentNode=null;this.isConnected=false;},
 replaceChildren(){const mark=n=>{n.isConnected=false;n.children?.forEach(mark);};this.children.forEach(mark);this.children=[];},
 contains(child){for(let n=child;n;n=n.parentElement)if(n===this)return true;return false;},closest:()=>null,querySelector:()=>null,querySelectorAll:()=>[],matches:()=>false,
 getBoundingClientRect(){return{left:0,top:0,width:this.clientWidth,height:this.clientHeight,right:this.clientWidth,bottom:this.clientHeight};},setPointerCapture(id){this.captured=id;},hasPointerCapture(id){return this.captured===id;},releasePointerCapture(){this.captured=null;},...extra};
}
export function canvas(){const text=[],draws=[],c={measureText:v=>({width:String(v).length*22}),fillText(v){text.push(String(v));},drawImage(...args){draws.push(args);},createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){}};for(const fn of ['fillRect','clearRect','beginPath','arc','clip','save','restore','translate','rotate','moveTo','lineTo','bezierCurveTo','stroke','fill'])c[fn]=()=>{};return node({text,draws,context:c,getContext:()=>c});}
export function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
export const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
