/* SPACE globe surface. Local MapLibre, public basemap tiles, private in-memory
 * markers. The controller remains responsible for authorization and expiry. */
(() => {
'use strict';
const VERSION='5.24.0';
const EARTH='https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg';
const STREETS='https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const WORLD={getSouth:()=>-90,getNorth:()=>90,getWest:()=>-180,getEast:()=>180};
const rad=n=>n*Math.PI/180,deg=n=>n*180/Math.PI,wrap=n=>((n+180)%360+360)%360-180;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const collection=features=>({type:'FeatureCollection',features});
const reduced=()=>!!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
let pending=null;
function load(){
 if(pending)return pending;
 const css=new Promise((resolve,reject)=>{
  let el=document.querySelector('[data-space-globe-css]');if(el?.dataset.ready==='true'){resolve();return;}
  if(!el){el=document.createElement('link');el.rel='stylesheet';el.href=`vendor/maplibre/maplibre-gl.css?v=${VERSION}`;el.dataset.spaceGlobeCss='';}
  const timer=setTimeout(()=>finish(Error('Globe stylesheet timed out')),12000);
  function finish(error){clearTimeout(timer);el.onload=el.onerror=null;if(error){el.remove();reject(error);}else{el.dataset.ready='true';resolve();}}
  el.onload=()=>finish();el.onerror=()=>finish(Error('Globe stylesheet unavailable'));if(!el.parentElement)document.head.append(el);
 });
 const js=window.maplibregl?Promise.resolve(window.maplibregl):new Promise((resolve,reject)=>{
  const el=document.createElement('script');el.src=`vendor/maplibre/maplibre-gl.js?v=${VERSION}`;el.async=true;
  const timer=setTimeout(()=>finish(Error('Globe download timed out')),12000);
  function finish(error){clearTimeout(timer);el.onload=el.onerror=null;if(error||!window.maplibregl){el.remove();reject(error||Error('Globe unavailable'));}else resolve(window.maplibregl);}
  el.onload=()=>finish();el.onerror=()=>finish(Error('Globe download failed'));document.head.append(el);
 });
 pending=Promise.all([css,js]).then(([,gl])=>{gl.setWorkerCount?.(2);return sdk(gl);}).catch(error=>{pending=null;throw error;});return pending;
}
// Decorative great-circle paths, never messages, journeys or member links.
function orbitPaths(){
 const routes=[[[-15,5],[10,50]],[[5,5],[80,25]],[[-5,-10],[-50,-15]],[[-75,35],[0,50]],[[140,35],[135,-25]]];
 const vector=([lon,lat])=>[Math.cos(rad(lat))*Math.cos(rad(lon)),Math.cos(rad(lat))*Math.sin(rad(lon)),Math.sin(rad(lat))];
 return collection(routes.map(([from,to])=>{const a=vector(from),b=vector(to),angle=Math.acos(Math.max(-1,Math.min(1,a.reduce((sum,v,i)=>sum+v*b[i],0)))),coords=[];for(let i=0;i<=40;i++){const t=i/40,x=Math.sin((1-t)*angle)/Math.sin(angle),y=Math.sin(t*angle)/Math.sin(angle),v=a.map((n,j)=>n*x+b[j]*y);coords.push([deg(Math.atan2(v[1],v[0])),deg(Math.atan2(v[2],Math.hypot(v[0],v[1])))]);}return {type:'Feature',properties:{},geometry:{type:'LineString',coordinates:coords}};}));
}
function style(streets=STREETS,attribution='© OpenStreetMap contributors'){
 return {version:8,projection:{type:'globe'},sources:{
  earth:{type:'raster',tiles:[EARTH],tileSize:256,maxzoom:8,attribution:'Imagery: NASA GIBS / ESDIS · Blue Marble'},
  orbits:{type:'geojson',data:orbitPaths()},
  landDots:{type:'geojson',data:'assets/maps/earth-dots.geojson'},
  streets:{type:'raster',tiles:[streets],tileSize:256,maxzoom:19,attribution}
 },layers:[
  {id:'ocean',type:'background',paint:{'background-color':'#0b2034'}},
  {id:'orbits',type:'line',source:'orbits',maxzoom:7,layout:{visibility:'none','line-cap':'round'},paint:{'line-color':'#c2a0f5','line-width':1.5,'line-opacity':.7,'line-dasharray':[0,2,3]}},
  {id:'land-dots',type:'circle',source:'landDots',maxzoom:8,layout:{visibility:'none'},paint:{'circle-color':'#9cb7d9','circle-radius':['interpolate',['linear'],['zoom'],0,1.15,4,1.8],'circle-opacity':.8}},
  {id:'earth',type:'raster',source:'earth',maxzoom:10,paint:{'raster-fade-duration':150,'raster-opacity':['interpolate',['linear'],['zoom'],7,1,10,0]}},
  {id:'streets',type:'raster',source:'streets',minzoom:6,paint:{'raster-fade-duration':150,'raster-opacity':['interpolate',['linear'],['zoom'],6,0,9,1]}}
 ],sky:{'sky-color':'#071423','horizon-color':'#7ab8e5','sky-horizon-blend':.7,'atmosphere-blend':['interpolate',['linear'],['zoom'],0,1,5,1,8,0]},light:{anchor:'map',position:[1.5,90,65]}};
}
// Minimum longitude arc, including pairs on opposite sides of the date line.
function extent(points){
 const valid=points.map(p=>Array.isArray(p)?{lat:p[0],lng:p[1]}:p).filter(p=>finite(p?.lat)&&finite(p?.lng)&&Math.abs(p.lat)<=90);
 if(!valid.length)return null;
 const xs=valid.map(p=>((p.lng%360)+360)%360).sort((a,b)=>a-b);let gap=-1,start=xs[0];
 for(let i=0;i<xs.length;i++){const next=i===xs.length-1?xs[0]+360:xs[i+1],d=next-xs[i];if(d>gap){gap=d;start=next%360;}}
 const width=360-gap,west=wrap(start);
 return [[west,Math.max(-85,Math.min(85,Math.min(...valid.map(p=>p.lat))))],[west+width,Math.max(-85,Math.min(85,Math.max(...valid.map(p=>p.lat))))]];
}
// Great-circle accuracy outline. Unwrapped vertices avoid a 360° date-line seam.
function circle(lat,lng,radius){
 const phi=rad(lat),lambda=rad(lng),distance=Math.min(50000,Math.max(0,radius))/6371008.8,ring=[];
 for(let i=0;i<=48;i++){const bearing=i/48*2*Math.PI,y=Math.asin(Math.sin(phi)*Math.cos(distance)+Math.cos(phi)*Math.sin(distance)*Math.cos(bearing)),x=lambda+Math.atan2(Math.sin(bearing)*Math.sin(distance)*Math.cos(phi),Math.cos(distance)-Math.sin(phi)*Math.sin(y));let lon=deg(x);while(lon-lng>180)lon-=360;while(lon-lng< -180)lon+=360;ring.push([lon,deg(y)]);}
 ring[ring.length-1]=[...ring[0]];return {type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[ring]}};
}
function front(point,center,zoom){return zoom>=5||Math.sin(rad(point.lat))*Math.sin(rad(center.lat))+Math.cos(rad(point.lat))*Math.cos(rad(center.lat))*Math.cos(rad(point.lng-center.lng))>.12;}
function buckets(entries,project,zoom,center){
 const groups=[],radius=zoom<10?58:42;
 for(const entry of entries){if(!front(entry.latlng,center,zoom))continue;const p=project([entry.latlng.lng,entry.latlng.lat]);if(!finite(p.x)||!finite(p.y))continue;let group=groups.find(g=>Math.hypot(p.x-g.pixel.x,p.y-g.pixel.y)<radius);if(!group){group={pixel:p,items:[]};groups.push(group);}group.items.push(entry);}
 return groups.map(g=>g.items);
}
function sdk(gl){
 const api={globe:true,map(node,options={}){
  const native=new gl.Map({container:node,style:style(),center:[-1.03,7.95],zoom:.25,minZoom:0,maxZoom:19,maxPitch:55,attributionControl:{compact:true},cooperativeGestures:true,scrollZoom:options.scrollWheelZoom!==false,renderWorldCopies:false,maxTileCacheSize:64,maxTileCacheZoomLevels:3,pixelRatio:Math.min(window.devicePixelRatio||1,2),refreshExpiredTiles:true});
  const groups=new Set(),tileLayers=new Set();let removed=false,ready=false,frame=0,look='earth',arcTimer=0,arcPhase=0;
  const hud=document.createElement('div');hud.className='space-globe-hud';hud.setAttribute('aria-hidden','true');const title=document.createElement('strong'),hint=document.createElement('span');hud.append(title,hint);node.append(hud);
  native.addControl(new gl.NavigationControl({visualizePitch:true}),'bottom-right');
  native.addControl(new gl.ScaleControl({maxWidth:100,unit:'metric'}),'bottom-left');
  function schedule(){if(removed||frame)return;frame=window.requestAnimationFrame(()=>{frame=0;if(removed)return;const z=native.getZoom();title.textContent=z<5?'THE WORLD IS YOUR SPACE':z<10?'A LITTLE CLOSER':'YOUR PEOPLE, NEARBY';hint.textContent=z<10?(look==='dots'?'Decorative arcs · Zoom for shared avatars':'Zoom in to reveal shared avatars'):'Tap an avatar · Only shared positions appear';syncArcs();node.dataset.globeView=z<5?'world':z<10?'area':'nearby';for(const group of groups)group.draw();});}
  function syncArcs(){const enabled=ready&&look==='dots'&&native.getZoom()<7&&!reduced()&&!navigator.connection?.saveData&&!removed;if(!enabled){clearInterval(arcTimer);arcTimer=0;return;}if(!arcTimer)arcTimer=setInterval(()=>{if(removed||document.hidden||reduced()||navigator.connection?.saveData){clearInterval(arcTimer);arcTimer=0;return;}const phases=[[0,2,3],[.5,2,2.5],[1,2,2],[1.5,2,1.5],[2,2,1],[2.5,2,.5],[3,2,0]];native.setPaintProperty('orbits','line-dasharray',phases[arcPhase++%phases.length]);},250);}
  native.on('move',schedule);native.on('zoom',schedule);native.on('resize',schedule);
  let resolveReady,rejectReady;
  const readyPromise=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  const timer=setTimeout(()=>{if(!ready&&!removed)rejectReady(Error('Globe initialization timed out'));},12000);
  native.on('style.load',()=>{if(removed)return;ready=true;clearTimeout(timer);resolveReady();map.setLook(look);for(const t of tileLayers)t.configure();schedule();});
  native.on('error',event=>{if(removed)return;for(const t of tileLayers)t.error(event);});
  const onContextLost=()=>{if(!removed)node.dispatchEvent(new CustomEvent('space-globe-lost',{bubbles:true}));};
  native.getCanvas().addEventListener('webglcontextlost',onContextLost);
  const map={native,groups,ready:readyPromise,get removed(){return removed;},
   on(event,fn){native.on(event,e=>{if(!removed)fn(event==='click'?{latlng:{lat:e.lngLat.lat,lng:wrap(e.lngLat.lng)}}:e);});return map;},
   setView(point,zoom,options={}){const p=Array.isArray(point)?{lat:point[0],lng:point[1]}:point;native.jumpTo({center:[wrap(p.lng),Math.max(-85,Math.min(85,p.lat))],zoom});schedule();return map;},
   getZoom(){return native.getZoom();},getBounds(){return native.getZoom()<4?WORLD:native.getBounds();},
   fitBounds(points,options={}){const b=extent(points);if(b)native.fitBounds(b,{padding:Math.min(45,options.padding?.[0]||40),maxZoom:options.maxZoom||14,duration:options.animate===false||reduced()?0:750});schedule();return map;},
   invalidateSize(){native.resize();return map;},
   world(){for(const g of groups){g.focused=null;g.closePopups();}native.easeTo({center:[native.getCenter().lng,15],zoom:.25,pitch:0,bearing:0,duration:reduced()?0:850});},
   remove(){if(removed)return;removed=true;clearTimeout(timer);clearInterval(arcTimer);arcTimer=0;if(!ready)rejectReady(Error('Globe closed'));if(frame)window.cancelAnimationFrame(frame);frame=0;for(const g of [...groups])g.remove();native.getCanvas().removeEventListener('webglcontextlost',onContextLost);hud.remove();native.remove();tileLayers.clear();},
   setLook(value){look=value==='dots'?'dots':'earth';if(native.isStyleLoaded()){native.setLayoutProperty('earth','visibility',look==='dots'?'none':'visible');native.setLayoutProperty('land-dots','visibility',look==='dots'?'visible':'none');native.setLayoutProperty('orbits','visibility',look==='dots'?'visible':'none');}node.dataset.globeLook=look;schedule();},getLook(){return look;},
   tileLayers,schedule
  };schedule();return map;
 },tileLayer(url,options={}){
  let map=null;const handlers=new Map();const tile={
   addTo(m){map=m;m.tileLayers.add(tile);if(m.native.isStyleLoaded())tile.configure();return tile;},
   configure(){if(!map||map.removed)return;const source=map.native.getSource('streets');if(url!==STREETS)source?.setTiles([url]);if(source&&options.attribution){source.attribution=options.attribution;map.native.fire('sourcedata',{sourceId:'streets',sourceDataType:'metadata'});}},
   on(name,fn){handlers.set(name,fn);return tile;},
   error(e){if(e.sourceId==='earth'){if(map?.native.isStyleLoaded()){map.native.setLayerZoomRange('streets',0,24);map.native.setPaintProperty('streets','raster-opacity',1);}handlers.get('eartherror')?.();}else if(e.sourceId==='streets')handlers.get('tileerror')?.();},
   redraw(){if(!map||map.removed)return;if(map.native.isStyleLoaded()){map.native.setLayerZoomRange('streets',6,24);map.native.setPaintProperty('streets','raster-opacity',['interpolate',['linear'],['zoom'],6,0,9,1]);map.setLook(map.getLook());}map.native.getSource('streets')?.setTiles([url]);map.native.getSource('earth')?.setTiles([EARTH]);}
  };return tile;
 },divIcon(options){return options;},marker(point,options={}){
  let group=null,popup=null,marker=null,element=null;const listeners=new Map(),latlng={lat:point[0],lng:point[1]};
  const entry={latlng,options,kind:options.icon?.className?.includes('person')?'person':'place',
   on(name,fn){listeners.set(name,fn);return entry;},getLatLng(){return latlng;},
   addTo(g){group=g;g.entries.push(entry);g.map.schedule();return entry;},
   bindPopup(node){popup=node;if(marker)marker.setPopup(new gl.Popup({offset:65,closeButton:true,maxWidth:'270px'}).setDOMContent(node));return entry;},
   show(offset=[0,0],small=false){
    if(!marker){element=document.createElement('button');element.type='button';element.className=entry.kind==='person'?'space-globe-person':'space-globe-place';element.title=String(options.title||'Club place');element.setAttribute('aria-label',element.title);const art=document.createElement('span');art.className='space-globe-character';if(!small)art.innerHTML=typeof options.icon?.html==='function'?options.icon.html():options.icon?.html||'';element.append(art);
     element.addEventListener('click',event=>{event.stopPropagation();if(entry.kind==='person'&&group.map.getZoom()<10)group.map.setView(latlng,12);listeners.get('click')?.();entry.openPopup();});
     marker=new gl.Marker({element,anchor:'bottom',offset,opacityWhenCovered:0}).setLngLat([latlng.lng,latlng.lat]);if(popup)marker.setPopup(new gl.Popup({offset:65,closeButton:true,maxWidth:'270px'}).setDOMContent(popup));marker.addTo(group.map.native);
    }
    if(!small&&element.dataset.detail==='dot'){const art=element.querySelector('.space-globe-character');if(art&&!art.innerHTML)art.innerHTML=typeof options.icon?.html==='function'?options.icon.html():options.icon?.html||'';}marker.setOffset(offset);element.dataset.detail=small?'dot':'avatar';element.style.setProperty('--avatar-scale',String(Math.min(1.1,Math.max(.72,.72+(group.map.getZoom()-10)*.065))));
   },closePopup(){marker?.getPopup()?.remove();},hide(){if(marker){marker.remove();marker=null;element=null;}},
   openPopup(){if(!group||group.map.removed)return entry;group.focused=entry;group.draw();if(marker&&popup){const p=marker.getPopup();if(p&&!p.isOpen())p.setLngLat([latlng.lng,latlng.lat]).addTo(group.map.native);}return entry;}
  };return entry;
 },circle(point,options){return {addTo(group){group.rings.push(circle(point[0],point[1],options.radius));group.changed();group.map.schedule();return this;}};},
 layerGroup(){
  let map=null,dead=false,circlesDirty=true;const clusters=new Map(),choosers=new Set();
  const group={entries:[],rings:[],focused:null,get map(){return map;},
   addTo(m){map=m;m.groups.add(group);return group;},
   changed(){circlesDirty=true;},
   closePopups(){for(const e of group.entries)e.closePopup();for(const p of choosers)p.remove();choosers.clear();},
   clearLayers(){group.closePopups();for(const e of group.entries)e.hide();for(const c of clusters.values())c.remove();clusters.clear();group.entries=[];group.rings=[];group.focused=null;circlesDirty=true;map?.schedule();},
   draw(){if(dead||!map||map.removed)return;const n=map.native,z=map.getZoom(),desired=new Set(),show=new Set();
    if(n.isStyleLoaded()){
     if(!n.getSource('space-accuracy')){n.addSource('space-accuracy',{type:'geojson',data:collection([])});n.addLayer({id:'space-accuracy',type:'fill',source:'space-accuracy',minzoom:10,paint:{'fill-color':'#8272c5','fill-opacity':.1,'fill-outline-color':'#8272c5'}});}
     if(circlesDirty){n.getSource('space-accuracy').setData(collection(group.rings));circlesDirty=false;}
    }
    const places=group.entries.filter(e=>e.kind==='place');for(const e of places){if(front(e.latlng,n.getCenter(),z)){e.show();show.add(e);}}
    const people=group.entries.filter(e=>e.kind==='person');
    if(group.focused&&people.includes(group.focused)){group.focused.show([0,0]);show.add(group.focused);}
    for(const set of buckets(people.filter(e=>e!==group.focused),p=>n.project(p),z,n.getCenter())){
     if(set.length===1){set[0].show([0,0],z<10);show.add(set[0]);continue;}
     if(z>=14){const count=Math.min(6,set.length);for(let i=0;i<count;i++){const theta=(i/count*2*Math.PI)-Math.PI/2,offset=[Math.round(Math.cos(theta)*58),Math.round(Math.sin(theta)*40)];set[i].show(offset);show.add(set[i]);}if(set.length<=6)continue;}
     const members=z>=14?set.slice(6):set,key=members.map(e=>group.entries.indexOf(e)).join('-');desired.add(key);
     if(!clusters.has(key)){
      const el=document.createElement('button');el.type='button';el.className='space-globe-cluster';el.textContent=String(members.length);el.setAttribute('aria-label',`${members.length} shared members. ${z>=14?'Choose a member':'Zoom in'}`);
      el.addEventListener('click',event=>{event.stopPropagation();if(map.removed)return;if(map.getZoom()<14){const b=extent(members.map(e=>e.latlng));n.fitBounds(b,{padding:80,maxZoom:Math.max(14.5,map.getZoom()+2),duration:reduced()?0:650});}else{const list=document.createElement('div');list.className='space-globe-overlap';const heading=document.createElement('strong');heading.textContent='Sharing this area';list.append(heading);for(const entry of members){const b=document.createElement('button');b.type='button';b.textContent=String(entry.options.title||'Club member');b.addEventListener('click',()=>{chooser.remove();choosers.delete(chooser);entry.openPopup();});list.append(b);}const chooser=new gl.Popup({maxWidth:'250px'}).setLngLat([members[0].latlng.lng,members[0].latlng.lat]).setDOMContent(list).addTo(n);choosers.add(chooser);}});
      const c=new gl.Marker({element:el,anchor:'center',offset:z>=14?[0,0]:[0,-8],opacityWhenCovered:0}).setLngLat([members[0].latlng.lng,members[0].latlng.lat]).addTo(n);clusters.set(key,c);
     }
    }
    for(const e of group.entries)if(!show.has(e))e.hide();for(const [key,c]of clusters)if(!desired.has(key)){c.remove();clusters.delete(key);}
   },
   remove(){if(dead)return;group.clearLayers();dead=true;map?.groups.delete(group);}
  };return group;
 }};
 return api;
}
window.SpaceGlobe={load,sdk,protocol:{extent,circle,front,buckets,style},version:VERSION};
})();
