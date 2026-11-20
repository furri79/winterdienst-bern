import {environmentResponse} from './environment.mjs';
const PLACES={bern:{lat:'46.948',lon:'7.447'},meikirch:{lat:'47.008804',lon:'7.363820'},blatten:{lat:'46.359364',lon:'7.983037'}};
const WARNING_POSTCODES={bern:'300100',meikirch:'304500',blatten:'391400'};
const IDS={riedbach:'041031202002',schwarzenburgstrasse:'041031202004',melchenbuehlweg:'041031202005',gamsenbruecke:null,meikirch:null};
const STATION_NAMES={gamsenbruecke:'Gamsenbrücke Principal',meikirch:'Meikirch'};
const KEY='bvision/latest.json';
const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin'};
const json=(body,status=200)=>Response.json(body,{status,headers});
const USER_KEY='access/invited-users-v1.json';
const SIGN_IN='/signin-with-chatgpt?return_to=%2F';
const emailAddress=value=>typeof value==='string'&&value.length<=254&&/^[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+$/i.test(value);
const htmlEscape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function usersDocument(env){
  if(!env.BUCKET)throw Error('Benutzerspeicher nicht verfügbar');
  const object=await env.BUCKET.get(USER_KEY),data=object?await object.json():{users:[]};
  if(!Array.isArray(data?.users))throw Error('Benutzerspeicher nicht lesbar');
  return {object,data};
}
async function accessFor(request,env){
  const id=request.headers.get('oai-authenticated-user-id'),email=request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
  if(!id||!emailAddress(email))return {signed_in:false,allowed:false,role:null};
  const owner=env.TSB_OWNER_EMAIL?.trim().toLowerCase();
  if(!emailAddress(owner))return {signed_in:true,allowed:false,unavailable:true};
  let name=request.headers.get('oai-authenticated-user-full-name')||email;
  if(request.headers.get('oai-authenticated-user-full-name-encoding')==='percent-encoded-utf-8')try{name=decodeURIComponent(name);}catch{name=email;}
  const user={id,email,name:name.slice(0,200)};
  if(email===owner)return {signed_in:true,allowed:true,role:'admin',user};
  try{
    const {data}=await usersDocument(env);
    return {signed_in:true,allowed:data.users.some(u=>u.email===email),role:'viewer',user};
  }catch{return {signed_in:true,allowed:false,unavailable:true,user};}
}
const TILE_KEYS=['ampel','official','weather','warnings','stations','radar','rain','webcam-bern','webcam-blatten','chart','hourly','report','models','outlook','winter','sources'];
export function cleanLayout(input){
  if(!input||input.version!==1||!Array.isArray(input.order)||input.order.length!==TILE_KEYS.length||new Set(input.order).size!==TILE_KEYS.length||input.order.some(key=>!TILE_KEYS.includes(key)))throw Error('Ungültige Kachelreihenfolge.');
  const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
  if(!record(input.open)||!record(input.wide)||Object.keys(input.open).length>150||Object.keys(input.wide).length>TILE_KEYS.length)throw Error('Ungültige Ansicht.');
  const open={},wide={};
  for(const [key,value] of Object.entries(input.open)){
    const base=key.replace(/--\d{1,2}$/,'');
    if(!TILE_KEYS.includes(base)||typeof value!=='boolean')throw Error('Ungültige Aufklappeinstellung.');
    open[key]=value;
  }
  for(const [key,value] of Object.entries(input.wide)){
    if(!TILE_KEYS.includes(key)||typeof value!=='boolean')throw Error('Ungültige Kachelbreite.');
    wide[key]=value;
  }
  return {version:1,order:[...input.order],open,wide};
}
async function personalLayout(request,env,access,url){
  if(!['GET','PUT'].includes(request.method))return json({error:'Methode nicht erlaubt.'},405);
  if(request.method==='PUT'&&request.headers.get('origin')!==url.origin)return json({error:'Ungültiger Ursprung.'},403);
  if(!env.BUCKET)return json({error:'Deine Ansicht kann momentan nicht gespeichert werden.'},503);
  // The authenticated account alone determines the storage key. Clients cannot select another user.
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(access.user.email));
  const key='preferences/layout-v1/'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')+'.json';
  if(request.method==='GET'){
    try{const object=await env.BUCKET.get(key);return json({layout:object?cleanLayout(await object.json()):null});}
    catch{return json({error:'Deine gespeicherte Ansicht konnte nicht geladen werden.'},503);}
  }
  if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'JSON erforderlich.'},415);
  let layout;
  try{const raw=await request.text();if(raw.length>12000)return json({error:'Ansicht zu gross.'},413);layout=cleanLayout(JSON.parse(raw));}
  catch{return json({error:'Ungültige Ansicht.'},400);}
  try{await env.BUCKET.put(key,JSON.stringify(layout),{httpMetadata:{contentType:'application/json'}});return json({ok:true,layout});}
  catch{return json({error:'Deine Ansicht konnte nicht gespeichert werden. Bitte erneut versuchen.'},503);}
}
function loginPage(access){
  const denied=access.signed_in;
  const title=access.unavailable?'Zugriff derzeit nicht prüfbar':denied?'Zugriff nicht freigegeben':'Willkommen beim Meteo Dashboard';
  const message=access.unavailable?'Die Zugriffsprüfung ist momentan nicht erreichbar. Bitte später erneut versuchen.':denied?'Dieses Konto wurde noch nicht eingeladen oder sein Zugang wurde entfernt. Bitte den Administrator kontaktieren.':'Dieses Dashboard ist nur für eingeladene Benutzer zugänglich. Melde dich mit der freigegebenen E-Mail-Adresse an.';
  return new Response('<!doctype html><html lang="de-CH"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Meteo Dashboard · Anmeldung</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#edf3f8;font:16px/1.6 system-ui;color:#17324a}main{box-sizing:border-box;max-width:540px;width:calc(100% - 32px);padding:32px;background:white;border:1px solid #d7e3ec;border-radius:20px;box-shadow:0 10px 40px #12345415}h1{font-size:26px;line-height:1.25}a{color:#205d87}.button{display:inline-block;border-radius:9px;padding:11px 18px;background:#123454;color:white;text-decoration:none;font-weight:700}small{display:block;color:#587186;margin-top:14px}</style></head><body><main><div style="font-size:38px">❄️ 🛣️</div><h1>'+title+'</h1><p>'+message+'</p>'+(access.user?'<p>Angemeldet als <b>'+htmlEscape(access.user.email)+'</b></p>':'')+'<p><a class="button" target="_top" href="'+(denied?'/signout-with-chatgpt?return_to=%2F':SIGN_IN)+'">'+(denied?'Anderes Konto verwenden':'Mit ChatGPT anmelden')+'</a></p><a target="_top" href="https://help.openai.com/en/articles/4936828-resetting-or-changing-your-chatgpt-password">Passwort vergessen?</a><small>Die Anmeldung und das Zurücksetzen des Passworts erfolgen beim Anmeldedienst. Bei Anmeldung über Google, Apple oder Microsoft verwaltest du das Passwort dort. Eine Registrierung im Dashboard ist nicht möglich.</small></main></body></html>',{status:access.unavailable?503:denied?403:200,headers:{...headers,'content-type':'text/html; charset=utf-8'}});
}
async function manageUsers(request,env,access,url){
  if(!access.allowed||access.role!=='admin')return json({error:'Nur der Hauptadministrator darf Benutzer verwalten.'},access.signed_in?403:401);
  if(request.method==='GET'){
    try{const {data}=await usersDocument(env);return json({users:data.users.map(u=>({id:u.id,email:u.email,created_at:u.created_at})),owner:access.user.email});}catch{return json({error:'Benutzerliste derzeit nicht verfügbar.'},503);}
  }
  if(!['POST','DELETE'].includes(request.method))return json({error:'Methode nicht erlaubt'},405);
  if(request.headers.get('origin')!==url.origin)return json({error:'Ungültiger Ursprung'},403);
  if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'JSON erforderlich'},415);
  let input;
  try{const body=await request.text();if(body.length>4096)throw Error();input=JSON.parse(body);}catch{return json({error:'Ungültige Eingabe'},400);}
  const email=typeof input.email==='string'?input.email.trim().toLowerCase():'';
  if(request.method==='POST'&&!emailAddress(email))return json({error:'Bitte eine gültige E-Mail-Adresse eingeben.'},400);
  if(request.method==='POST'&&email===access.user.email)return json({error:'Das Hauptadministratorkonto ist bereits freigegeben.'},400);
  if(request.method==='DELETE'&&(typeof input.id!=='string'||input.id.length>80))return json({error:'Benutzer fehlt.'},400);
  try{
    for(let retry=0;retry<3;retry++){
      const {object,data}=await usersDocument(env);
      let user;
      if(request.method==='POST'){
        user=data.users.find(u=>u.email===email);
        if(user)return json({ok:true,already_exists:true,email,invite_url:url.origin+SIGN_IN});
        if(data.users.length>=250)return json({error:'Die Benutzerliste ist voll.'},400);
        user={id:crypto.randomUUID(),email,created_at:new Date().toISOString()};data.users.push(user);
      }else{
        user=data.users.find(u=>u.id===input.id);
        if(!user)return json({ok:true});
        if(user.email===access.user.email)return json({error:'Der Hauptadministrator kann nicht entfernt werden.'},400);
        data.users=data.users.filter(u=>u.id!==input.id);
      }
      const result=await env.BUCKET.put(USER_KEY,JSON.stringify(data),{httpMetadata:{contentType:'application/json'},onlyIf:object?{etagMatches:object.etag}:{etagDoesNotMatch:'*'}});
      if(result)return json(request.method==='POST'?{ok:true,email,invite_url:url.origin+SIGN_IN}:{ok:true});
    }
    return json({error:'Die Liste wurde gleichzeitig geändert. Bitte erneut versuchen.'},409);
  }catch{return json({error:'Benutzerverwaltung derzeit nicht verfügbar.'},503);}
}
const temperature=v=>v===null || typeof v==='number' && Number.isFinite(v) && v>=-40 && v<=60;
function timestamp(v,now){
  if(typeof v!=='string'||!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v))return false;
  const t=Date.parse(v);return Number.isFinite(t)&&t<=now+300000;
}
export function cleanMeasurements(raw,now=Date.now()){
  if(!raw || !timestamp(raw.updated_at,now) || !raw.stations || typeof raw.stations!=='object'||Array.isArray(raw.stations))throw Error('Ungültiges Datenformat');
  const result={updated_at:raw.updated_at,received_at:new Date(now).toISOString(),stations:{}};
  for(const [key,id] of Object.entries(IDS)){
    const i=raw.stations[key];if(!i)continue;
    if((id?i.station_id!==id:typeof i.station_id!=='string'||!/^\d{1,32}$/.test(i.station_id)||i.station_name!==STATION_NAMES[key])||!timestamp(i.observed_at,now)||!temperature(i.road_temperature_c)||!temperature(i.freezing_point_c))throw Error('Ungültige Stationsmessung');
    if(i.road_condition!==null && (typeof i.road_condition!=='string'||i.road_condition.length>100))throw Error('Ungültiger Fahrbahnzustand');
    if(i.air_temperature_c!==undefined && !temperature(i.air_temperature_c))throw Error('Ungültige Lufttemperatur');
    if(i.relative_humidity_pct!==undefined && i.relative_humidity_pct!==null && !(typeof i.relative_humidity_pct==='number'&&Number.isFinite(i.relative_humidity_pct)&&i.relative_humidity_pct>=0&&i.relative_humidity_pct<=100))throw Error('Ungültige Luftfeuchtigkeit');
    result.stations[key]={station_id:i.station_id,...(!id?{station_name:STATION_NAMES[key]}:{}),observed_at:i.observed_at,road_temperature_c:i.road_temperature_c,freezing_point_c:i.freezing_point_c,road_condition:i.road_condition,air_temperature_c:i.air_temperature_c??null,relative_humidity_pct:i.relative_humidity_pct??null};
  }
  if(!Object.keys(result.stations).length)throw Error('Keine TSB-Messstellen');
  return result;
}
async function sameSecret(a,b){
  if(!a || !b)return false;
  const hash=async v=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)));
  const [x,y]=await Promise.all([hash(a),hash(b)]);let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0;
}
export function cleanOfficialWarnings(raw,now=Date.now()){
  if(!raw || !Array.isArray(raw.warnings))throw Error('Warnungsdaten fehlen');
  const warnings=[];
  for(const w of raw.warnings){
    if(!w || !Array.isArray(w.links))throw Error('Warnungsquelle fehlt');
    const hosts=w.links.map(link=>{try{return new URL(link.url).hostname;}catch{return '';}});
    const meteo=hosts.some(host=>/^(www\.)?meteos(chweiz|wiss|uisse|vizzera)\.admin\.ch$/.test(host));
    if(!meteo){
      if(hosts.some(host=>/^(www\.)?(bafu\.admin\.ch|waldbrandgefahr\.ch|slf\.ch|seismo\.ethz\.ch)$/.test(host)))continue;
      throw Error('Warnungsherausgeber unbekannt');
    }
    if(!Number.isInteger(w.warnLevel)||w.warnLevel<2||w.warnLevel>5||!Number.isFinite(w.validFrom)||typeof w.text!=='string'||!w.text.trim()||w.validTo!=null&&(!Number.isFinite(w.validTo)||w.validTo<=w.validFrom))throw Error('Unvollständige Warnung');
    if(w.validTo!=null&&w.validTo<=now)continue;
    const types={wind:['Wind','🌬️'],gewitter:['Gewitter','⛈️'],regen:['Regen','🌧️'],schnee:['Schnee','🌨️'],strassenglaette:['Strassenglätte','🧊'],hitze:['Hitze','🌡️'],frost:['Frost','❄️']};
    const slug=Object.keys(types).find(key=>w.links.some(link=>{try{return new URL(link.url).pathname.split('/').includes(key+'.html');}catch{return false;}}));
    const [title,icon]=types[slug]||['Wetterwarnung','⚠️'];
    warnings.push({title,icon,level:w.warnLevel,text:w.text.slice(0,12000),valid_from:w.validFrom,valid_to:w.validTo??null,outlook:w.outlook===true,region_id:w.regionId??null});
  }
  return warnings.sort((a,b)=>b.level-a.level||a.valid_from-b.valid_from);
}
export function cleanCfsPage(html,variable,now=Date.now()){
  const plain=html.replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ');
  const ic=plain.match(/ICs:\s*(\d{8})\s*-\s*(\d{8})/i);
  if(!ic)throw Error('CFSv2-Modellstand fehlt');
  const iso=value=>value.slice(0,4)+'-'+value.slice(4,6)+'-'+value.slice(6,8);
  const initial=Date.parse(iso(ic[2])+'T00:00:00Z');
  if(!Number.isFinite(initial)||initial>now+86400000||now-initial>14*86400000)throw Error('CFSv2-Modellstand veraltet');
  const months={Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};
  const dates=[...new Set([...plain.matchAll(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(20\d{2})\b/g)].map(m=>m[2]+'-'+String(months[m[1]]).padStart(2,'0')+'-01'))].sort();
  if(dates.length<3)throw Error('CFSv2-Zeiträume fehlen');
  return {variable,initial_from:iso(ic[1]),initial_to:iso(ic[2]),maps:dates.slice(0,3).map((month,index)=>({month,url:'https://www.cpc.ncep.noaa.gov/products/CFSv2/imagesInd3/eu'+(variable==='temperature'?'T2m':'Prec')+'MonInd'+(index+1)+'.gif'}))};
}
export function createWorker(assets){
  return {async fetch(request,env){
    const url=new URL(request.url),path=url.pathname;
    const upload=path==='/api/bvision'&&request.method==='POST';
    const publicAsset=/^\/(?:favicon\.ico|manifest\.webmanifest|icon-(?:192|512)-v3\.png|apple-touch-icon(?:-\d+x\d+)?\.png)$/.test(path);
    const access=upload||publicAsset?null:await accessFor(request,env);
    if(path==='/api/session')return json(access);
    if(path==='/api/admin/users')return manageUsers(request,env,access,url);
    if(!upload&&!publicAsset&&!access.allowed){
      if(path.startsWith('/api/'))return json({error:access.unavailable?'Zugriffsprüfung derzeit nicht verfügbar.':access.signed_in?'Zugriff nicht freigegeben.':'Bitte anmelden.'},access.unavailable?503:access.signed_in?403:401);
      return loginPage(access);
    }
    if(path==='/api/preferences/layout')return personalLayout(request,env,access,url);
    if(path==='/api/environment')return environmentResponse(request,env,cleanOfficialWarnings);
    if(path.endsWith('.zip')&&access?.role!=='admin')return json({error:'Nur für Administratoren.'},403);
    if(path==='/api/seasonal-europe'){
      if(request.method!=='GET')return json({error:'GET erforderlich'},405);
      const key='weather/ecmwf-europe-charts-v1.json';
      try{const object=await env.BUCKET?.get(key);const entry=object?await object.json():null;if(entry&&Date.now()-entry.fetched_at>=0&&Date.now()-entry.fetched_at<21600000)return json(entry);}catch{}
      const products=[['extended-anomaly-2t','Temperatur · Wochenabweichung','EC46'],['extended-anomaly-tp','Niederschlag · Wochenabweichung','EC46'],['seasonal_system5_standard_2mtm','Temperatur · Saisonausblick','SEAS5'],['seasonal_system5_standard_rain','Niederschlag · Saisonausblick','SEAS5']];
      const results=await Promise.allSettled(products.map(async([product,title,model])=>{
        const source='https://charts.ecmwf.int/opencharts-api/v1/products/'+product+'/?'+(model==='EC46'?'projection=opencharts_europe':'area=EURO');
        const response=await fetch(source,{signal:AbortSignal.timeout(20000)});
        if(!response.ok)throw Error('ECMWF-Karte nicht verfügbar');
        const raw=await response.json(),chart=raw?.data;
        if(chart?.attributes?.name!==product||chart?.link?.type!=='image/png'||!/^https:\/\/charts\.ecmwf\.int\/content\/[A-Za-z0-9-]+\.png$/.test(chart?.link?.href))throw Error('ECMWF-Karte unvollständig');
        const description=chart.attributes.description||'';
        if(model==='EC46'){
          const base=description.match(/Base time:\s*([A-Za-z]{3} \d{1,2} [A-Za-z]{3} \d{4})/);
          const stamp=base?Date.parse(base[1]+' 00:00:00 GMT'):NaN;
          if(!Number.isFinite(stamp)||Date.now()-stamp>7*86400000||stamp>Date.now()+86400000||!/Area\s*:\s*Europe/.test(description))throw Error('ECMWF-Modellstand nicht aktuell');
        }
        return {product,title,model,description:description.slice(0,500),url:chart.link.href,source:'https://charts.ecmwf.int/products/'+product+'?'+(model==='EC46'?'projection=opencharts_europe':'area=EURO')};
      }));
      const maps=results.filter(r=>r.status==='fulfilled').map(r=>r.value);
      if(!maps.length)return json({error:'Europäische Modellkarten derzeit nicht verfügbar'},502);
      const payload={source:'ECMWF',fetched_at:Date.now(),maps,missing:4-maps.length};
      try{await env.BUCKET?.put(key,JSON.stringify(payload),{httpMetadata:{contentType:'application/json'}});}catch{}
      return json(payload);
    }
    if(path==='/api/seasonal-us'){
      if(request.method!=='GET')return json({error:'GET erforderlich'},405);
      const key='weather/noaa-cfsv2-europe-v1.json';
      try{const object=await env.BUCKET?.get(key);const entry=object?await object.json():null;if(entry&&Date.now()-entry.fetched_at>=0&&Date.now()-entry.fetched_at<21600000)return json(entry);}catch{}
      try{
        const models=await Promise.all(['temperature','precipitation'].map(async variable=>{
          const source='https://www.cpc.ncep.noaa.gov/products/CFSv2/htmls/eu'+(variable==='temperature'?'T2m':'Prec')+'e3Mon.html';
          const response=await fetch(source,{signal:AbortSignal.timeout(15000)});
          if(!response.ok)throw Error('NOAA nicht verfügbar');
          return {...cleanCfsPage(await response.text(),variable),source};
        }));
        const payload={source:'NOAA / NCEP CFSv2',fetched_at:Date.now(),models};
        try{await env.BUCKET?.put(key,JSON.stringify(payload),{httpMetadata:{contentType:'application/json'}});}catch{}
        return json(payload);
      }catch{return json({error:'Amerikanische Langfristmodelle derzeit nicht verfügbar'},502);}
    }
    if(path==='/api/warnings'){
      const location=url.searchParams.get('location')||'bern';
      if(!Object.hasOwn(WARNING_POSTCODES,location))return json({error:'Unbekannter Ort'},400);
      if(request.method!=='GET')return json({error:'GET erforderlich'},405);
      const cacheKey='warnings/meteoswiss-v1/'+location+'.json';
      try{
        const cached=await env.BUCKET?.get(cacheKey);const entry=cached?await cached.json():null;
        if(entry?.location===location&&Array.isArray(entry.warnings)&&Number.isFinite(entry.fetched_at)&&Date.now()-entry.fetched_at>=0&&Date.now()-entry.fetched_at<300000)return json(entry);
      }catch{}
      try{
        const source='https://app-prod-ws.meteoswiss-app.ch/v1/plzDetail?plz='+WARNING_POSTCODES[location]+'&lang=de';
        const upstream=await fetch(source,{headers:{'Accept-Language':'de'},signal:AbortSignal.timeout(12000)});
        if(!upstream.ok)throw Error('Warnungsquelle nicht erreichbar');
        const raw=await upstream.json();const now=Date.now();
        const payload={location,postcode:WARNING_POSTCODES[location].slice(0,4),source:'MeteoSchweiz',fetched_at:now,warnings:cleanOfficialWarnings(raw,now)};
        try{await env.BUCKET?.put(cacheKey,JSON.stringify(payload),{httpMetadata:{contentType:'application/json'}});}catch{}
        return json(payload);
      }catch{return json({error:'MeteoSchweiz-Warnungen derzeit nicht verfügbar'},502);}
    }
    if(path==='/api/weather'||path==='/api/seasonal'){
      const seasonal=path==='/api/seasonal';
      const location=url.searchParams.get('location')||'bern';
      if(!Object.hasOwn(PLACES,location))return json({error:'Unbekannter Ort'},400);
      const place=PLACES[location];
      if(request.method!=='GET')return json({error:'GET erforderlich'},405);
      const model=seasonal?'seasonal':url.searchParams.get('model')||'meteoswiss';
      const models={meteoswiss:'meteoswiss_icon_seamless',ecmwf:'ecmwf_ifs',gfs:'gfs_seamless',seasonal:'ecmwf_seasonal_ensemble_mean_seamless'};
      if(!Object.hasOwn(models,model)||!seasonal&&model==='seasonal')return json({error:'Unbekanntes Modell'},400);
      const source=new URL(seasonal?'https://seasonal-api.open-meteo.com/v1/seasonal':'https://api.open-meteo.com/v1/forecast');
      source.search=new URLSearchParams({latitude:place.lat,longitude:place.lon,timezone:'Europe/Zurich',forecast_days:'4',models:models[model],current:'temperature_2m,wind_speed_10m,wind_gusts_10m,weather_code,is_day',hourly:'temperature_2m,dew_point_2m,precipitation,rain,showers,snowfall,weather_code,snowfall_height,wind_speed_10m,is_day'}).toString();
      if(seasonal)source.search=new URLSearchParams({latitude:place.lat,longitude:place.lon,timezone:'Europe/Zurich',forecast_days:'100',models:models[model],weekly:'temperature_2m_anomaly,precipitation_anomaly',monthly:'temperature_2m_anomaly,precipitation_anomaly'}).toString();
      const cacheTtl=seasonal?21600000:600000;
      const hasData=data=>seasonal?Boolean(data?.weekly?.time?.length||data?.monthly?.time?.length):Boolean(data?.hourly?.time?.length);
      // Sites isolates do not permit access to caches.default. Keep optional
      // weather caching in the already provisioned bucket; a cache failure must
      // never prevent fetching or returning the current weather.
      const cacheKey='weather/'+location+'/'+model+(seasonal?'':'-72h-v3')+'.json';
      const weatherHeaders={'cache-control':'private, no-store','x-content-type-options':'nosniff','x-weather-model':models[model],'x-weather-location':location};
      try{
        const cached=await env.BUCKET?.get(cacheKey);
        const entry=cached?await cached.json():null;
        if(entry && Number.isFinite(entry.saved_at) && Date.now()-entry.saved_at>=0 && Date.now()-entry.saved_at<cacheTtl && hasData(entry.payload))return Response.json(entry.payload,{headers:weatherHeaders});
      }catch{/* Continue with the upstream request if the cache is unavailable. */}
      try{
        const upstream=await fetch(source,{signal:AbortSignal.timeout(20000)});
        if(!upstream.ok){console.error('weather_upstream',model,upstream.status,(await upstream.text()).slice(0,250));return json({error:'Wettermodell derzeit nicht erreichbar'},502);}
        const data=await upstream.json();
        if(!hasData(data))return json({error:'Unvollständige Wetterdaten'},502);
        const response=Response.json(data,{headers:weatherHeaders});
        try{await env.BUCKET?.put(cacheKey,JSON.stringify({saved_at:Date.now(),payload:data}),{httpMetadata:{contentType:'application/json'}});}catch{/* Current weather remains available even without cache storage. */}
        return response;
      }catch(error){console.error('weather_fetch',model,String(error?.message||'Unbekannter Abruffehler').slice(0,180));return json({error:'Wettermodell konnte nicht geladen werden'},502);}
    }
    const isOwner=Boolean(env.TSB_OWNER_EMAIL && request.headers.get('oai-authenticated-user-id') && request.headers.get('oai-authenticated-user-email')?.toLowerCase()===env.TSB_OWNER_EMAIL.toLowerCase());
    if(path==='/api/bvision/setup'){
      if(request.method!=='POST')return json({error:'POST erforderlich'},405);
      if(!isOwner)return json({error:'Bitte mit dem Eigentümer-Konto anmelden.'},401);
      if(request.headers.get('origin')!==url.origin)return json({error:'Ungültiger Ursprung'},403);
      if(!env.TSB_UPLOAD_TOKEN)return json({error:'Übertragung nicht konfiguriert'},503);
      return json({upload_token:env.TSB_UPLOAD_TOKEN});
    }
    if(path==='/api/bvision' || path==='/bvision-data.json'){
      if(!env.BUCKET)return json({error:'Online-Speicher noch nicht verfügbar'},503);
      if(request.method==='GET'){
        const object=await env.BUCKET.get(KEY);
        return object?json(await object.json()):json({error:'Noch keine Messwerte vom PC übertragen'},404);
      }
      if(request.method!=='POST' || path!=='/api/bvision')return json({error:'Methode nicht erlaubt'},405);
      const bearer=request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{32,100})$/)?.[1];
      if(!await sameSecret(bearer,env.TSB_UPLOAD_TOKEN))return json({error:'Übertragung nicht autorisiert'},401);
      if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'JSON erforderlich'},415);
      if(Number(request.headers.get('content-length'))>16384)return json({error:'Daten zu gross'},413);
      let next;
      try{
        const raw=await request.text();if(raw.length>16384)return json({error:'Daten zu gross'},413);
        next=cleanMeasurements(JSON.parse(raw));
      }catch{return json({error:'Ungültige Messwerte'},400);}
      // Conditional R2 writes prevent older concurrent uploads overwriting newer data.
      for(let retry=0;retry<3;retry++){
        const previous=await env.BUCKET.get(KEY);
        const old=previous?await previous.json():null;
        const merged={...next,stations:{...(old?.stations||{}),...next.stations}};
        if(old){
          for(const key of Object.keys(next.stations)){
            if(old.stations[key] && Date.parse(old.stations[key].observed_at)>Date.parse(next.stations[key].observed_at))merged.stations[key]=old.stations[key];
          }
          if(Date.parse(old.updated_at)>Date.parse(next.updated_at))merged.updated_at=old.updated_at;
        }
        const written=await env.BUCKET.put(KEY,JSON.stringify(merged),{httpMetadata:{contentType:'application/json'},onlyIf:previous?{etagMatches:previous.etag}:{etagDoesNotMatch:'*'}});
        if(written)return json({ok:true,received_at:merged.received_at,stations:Object.keys(merged.stations).length});
      }
      return json({error:'Gleichzeitiger Upload, bitte erneut versuchen'},409);
    }
    if(path.startsWith('/api/'))return json({error:'Nicht gefunden'},404);
    if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers});
    const entry=assets[path==='/'?'/index.html':path];
    if(!entry)return new Response('Not found',{status:404,headers});
    const bytes=Uint8Array.from(atob(entry.data),c=>c.charCodeAt(0));
    return new Response(request.method==='HEAD'?null:bytes,{headers:{...headers,'content-type':entry.type,'cache-control':publicAsset?'public, max-age=3600':'private, no-store'}});
  }};
}
