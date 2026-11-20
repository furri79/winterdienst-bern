// Additional disciplines use independent data and rules; the winter dashboard is unchanged.
export const ENV_POINTS={bern:{id:'bern',name:'Bern · Stadtmitte',lat:46.948,lon:7.447,scope:'Stadtgebiet'},west:{id:'west',name:'Bern · Westen',lat:46.945,lon:7.377,scope:'Stadtgebiet'},ost:{id:'ost',name:'Bern · Osten',lat:46.95,lon:7.50,scope:'Stadtgebiet'},belp:{id:'belp',name:'Belp · Aare-Zulaufgebiet',lat:46.89,lon:7.50,scope:'Regionaler Kontext'},thun:{id:'thun',name:'Thun · Aare oberhalb Bern',lat:46.758,lon:7.63,scope:'Regionaler Kontext'},meikirch:{id:'meikirch',name:'Meikirch',lat:47.008804,lon:7.363820},blatten:{id:'blatten',name:'Blatten bei Naters',lat:46.359364,lon:7.983037}};
const HYDRO_URL=id=>'https://www.hydrodaten.admin.ch/de/seen-und-fluesse/stationen-und-daten/'+id;
const CANTON_URL='https://www.wada.sites.be.ch/wasserdaten/wasser/liste_ns/Meteo_Internet.xml';
const SMN_URL='https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn/ber/ogd-smn_ber_t_now.csv';
const cleanText=value=>String(value).replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
export function sourceDate(value,utc=false){
 const m=String(value).match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/);if(!m)return null;
 const wall=Date.UTC(+m[3],+m[2]-1,+m[1],+m[4],+m[5]);let instant=wall;
 if(!utc)for(let i=0;i<2;i++){const off=new Intl.DateTimeFormat('en',{timeZone:'Europe/Zurich',timeZoneName:'shortOffset'}).formatToParts(new Date(instant)).find(p=>p.type==='timeZoneName').value;const z=off.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);instant=wall-(z?(z[1]==='-'?-1:1)*(+z[2]*60+ +(z[3]||0))*60000:0);}
 return new Date(instant).toISOString();
}
const finite=value=>{const s=String(value??'').trim().replace(',','.');return /^-?\d+(?:\.\d+)?$/.test(s)?Number(s):null;};
export function parseGauge(html,id){
 if(!['2135','2030'].includes(id)||!html.includes('<small>'+id+'</small>'))throw Error('Stationszuordnung fehlt');
 const row=[...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].find(m=>m[1].includes('Letzter Messwert'));
 if(!row)throw Error('Aktuelle Messzeile fehlt');const cells=[...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>cleanText(m[1]));
 const observed_at=sourceDate(cells[0]);if(!observed_at||cells.length<3)throw Error('Messzeit fehlt');
 const notices=[...html.matchAll(/<div[^>]*class="[^"]*alert[^\"]*"[^>]*>[\s\S]*?<strong[^>]*>[\s\S]*?<\/strong>\s*<div[^>]*>([\s\S]*?)<\/div>/gi)].map(m=>cleanText(m[1])).filter(Boolean);
 const discharge=finite(cells[1]),level=finite(cells[2]);if(discharge===null&&level===null)throw Error('Messwerte fehlen');
 const history={};for(const [key,label] of [['mean','Mittelwert 24h'],['max','Maximum 24h'],['min','Minimum 24h']]){
  const match=[...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].find(m=>cleanText(m[1]).startsWith(label));
  const values=match?[...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>cleanText(m[1])):[];
  history[key]={discharge_m3s:finite(values[1]),water_level_m:finite(values[2])};
 }

 return {id,name:id==='2135'?'Aare · Bern, Schönau':'Aare · Thun',observed_at,discharge_m3s:discharge!==null&&discharge>=0&&discharge<10000?discharge:null,water_level_m:level!==null&&level>0&&level<2000?level:null,notice:notices.join(' ').slice(0,1000),history_24h:history,source:'BAFU',url:HYDRO_URL(id)};
}
export function parseCantonRain(xml){
 const rows=[];for(const m of xml.matchAll(/<MesPar\b([^>]*)>([\s\S]*?)<\/MesPar>/g)){
  const id=m[1].match(/StrNr="([^"]+)"/)?.[1],type=m[1].match(/Typ="([^"]+)"/)?.[1];if(!['5530','5790','5510','R011','R012'].includes(id)||type!=='12')continue;
  const tag=name=>m[2].match(new RegExp('<'+name+'>([\\s\\S]*?)</'+name+'>'))?.[1]||'';
  const amount=finite(tag('Wert')),observed_at=sourceDate(tag('Datum')+' '+tag('Zeit'));if(!observed_at||amount===null||amount<0)continue;
  rows.push({id,station_code:({'5530':'MUB','5790':'LAP','5510':'BEP'})[id]||id,name:cleanText(tag('Name')).replace(/\s*\*$/,''),value_mmh:amount,unit:'mm/h',observed_at,source:['5530','5790','5510'].includes(id)?'MeteoSchweiz via AWA Kanton Bern':'AWA Kanton Bern',period:'Quellwert gemäss kantonaler Tabelle, angegeben in mm/h',url:'https://www.wada.sites.be.ch/wasserdaten/wasser/liste_ns/liste_ns.html'});
 }if(!rows.length)throw Error('Keine regionalen Stationswerte');return rows;
}
export function parseSmn(csv,previous=[]){
 const lines=csv.replace(/^\uFEFF/,'').trim().split(/\r?\n/),header=lines.shift().split(';');
 const rows=lines.map(line=>{const cols=line.split(';'),get=key=>cols[header.indexOf(key)];return {station:get('station_abbr'),observed_at:sourceDate(get('reference_timestamp'),true),rain_10min_mm:finite(get('rre150z0')),gust_kmh:finite(get('fu3010z1'))};}).filter(r=>r.station==='BER'&&r.observed_at).sort((a,b)=>Date.parse(a.observed_at)-Date.parse(b.observed_at));
 if(!rows.length)throw Error('Bern-Messung fehlt');
 const known=Array.isArray(previous)?previous.filter(r=>r?.station==='BER'&&Number.isFinite(Date.parse(r.observed_at))&&r.observed_at<=rows.at(-1).observed_at).slice(-12):[];
 const merged=[...new Map([...known,...rows].map(r=>[r.observed_at,r])).values()].sort((a,b)=>Date.parse(a.observed_at)-Date.parse(b.observed_at));
 const latest=merged.at(-1);if(!latest)throw Error('Bern-Messung fehlt');const end=Date.parse(latest.observed_at),last=merged.filter(r=>Date.parse(r.observed_at)>end-3600000&&Date.parse(r.observed_at)<=end);
 const complete=last.length===6&&last.every((r,i)=>r.rain_10min_mm!==null&&r.rain_10min_mm>=0&&Date.parse(r.observed_at)===end-(5-i)*600000);
 return {...latest,recent_samples:merged.slice(-12),rain_hour_mm:complete?last.reduce((sum,r)=>sum+r.rain_10min_mm,0):null,name:'Bern / Zollikofen',source:'MeteoSchweiz · SwissMetNet',url:SMN_URL};
}
export function cleanEnvForecast(raw,points,now=Date.now()){
 const list=Array.isArray(raw)?raw:[raw];if(list.length!==points.length)throw Error('Räumliche Prognose unvollständig');
 return list.map((data,index)=>{
  if(!Array.isArray(data.hourly?.time)||data.hourly_units?.precipitation!=='mm'||data.hourly_units?.wind_gusts_10m!=='km/h')throw Error('Prognoseeinheiten fehlen');
  const num=(key,i)=>{const value=data.hourly[key]?.[i];return typeof value==='number'&&Number.isFinite(value)?value:null;};
  const hours=data.hourly.time.map((time,i)=>({time:time.endsWith('Z')?time:time+'Z',precip_mm:num('precipitation',i),gust_kmh:num('wind_gusts_10m',i),wind_kmh:num('wind_speed_10m',i),code:num('weather_code',i),rain_mm:(num('rain',i)!==null&&num('showers',i)!==null?num('rain',i)+num('showers',i):null),snow_cm:num('snowfall',i)})).filter(row=>Date.parse(row.time)>Math.floor(now/3600000)*3600000&&Date.parse(row.time)<now+48*3600000);
  if(!hours.length)throw Error('Keine aktuelle Prognose');return {...points[index],hours};
 });
}
async function readSource(url,kind='text'){
 const response=await fetch(url,{signal:AbortSignal.timeout(12000),headers:{'Accept-Language':'de'}});if(!response.ok){const error=Error(response.status===429?'Abruflimit des Wetterdienstes erreicht (HTTP 429)':'Quelle nicht erreichbar (HTTP '+response.status+')');error.status=response.status;throw error;}return kind==='json'?response.json():response.text();
}
async function forecast(points){
 let last;for(const model of ['meteoswiss_icon_seamless','ecmwf_ifs'])try{
  const url=new URL('https://api.open-meteo.com/v1/forecast');url.search=new URLSearchParams({latitude:points.map(p=>p.lat).join(','),longitude:points.map(p=>p.lon).join(','),timezone:'UTC',forecast_days:'3',hourly:'precipitation,rain,showers,snowfall,weather_code,wind_gusts_10m,wind_speed_10m',models:model}).toString();
  const raw=await readSource(url.href,'json');return {model:model.startsWith('meteoswiss')?'MeteoSchweiz ICON CH1/CH2 über Open-Meteo':'ECMWF IFS über Open-Meteo',points:cleanEnvForecast(raw,points)};
 }catch(error){last=error;if(error.status===429)break;}throw last;
}
export function cleanEnvironmentWarnings(raw,cleanWarnings,now=Date.now()){
 if(!Array.isArray(raw?.warnings))throw Error('Warnungsdaten fehlen');
 const weather=[],other_items=[];
 for(const warning of raw.warnings){
  const links=(warning.links||[]).flatMap(link=>[link.url,link.altUrl]).map(value=>{try{const u=new URL(value);return u.protocol==='https:'?u:null;}catch{return null;}}).filter(Boolean);
  const isMeteo=links.some(u=>/^(www\.)?meteos(chweiz|wiss|uisse|vizzera)\.admin\.ch$/.test(u.hostname));
  const publisher=links.find(u=>/^(www\.)?(waldbrandgefahr\.ch|forestfiredanger\.ch|slf\.ch|bafu\.admin\.ch|seismo\.ethz\.ch)$/.test(u.hostname));
  if(!isMeteo&&publisher){
   if(!Number.isInteger(warning.warnLevel)||warning.warnLevel<2||warning.warnLevel>5||!Number.isFinite(warning.validFrom)||warning.validTo!=null&&(!Number.isFinite(warning.validTo)||warning.validTo<=warning.validFrom))throw Error('Unvollständige Bundesmeldung');
   if(warning.validTo!=null&&warning.validTo<=now)continue;
   const forest=/waldbrandgefahr|forestfiredanger/.test(publisher.hostname),avalanche=/slf\.ch$/.test(publisher.hostname);
   other_items.push({title:forest?'Waldbrand':avalanche?'Lawinen':'Weitere Bundesmeldung',source:avalanche?'WSL-Institut SLF':/seismo\.ethz\.ch$/.test(publisher.hostname)?'Schweizerischer Erdbebendienst SED':'BAFU / Bundesfachstelle',level:warning.warnLevel,valid_from:warning.validFrom,valid_to:warning.validTo??null,text:cleanText(warning.text||warning.htmlText||'').slice(0,4000),url:publisher.href});
  }else weather.push(warning);
 }
 return {source:'MeteoSchweiz',items:cleanWarnings({warnings:weather},now),other_items};
}
export async function environmentResponse(request,env,cleanWarnings){
 const url=new URL(request.url),area=url.searchParams.get('area'),location=area==='drainage'?'bern':url.searchParams.get('location')||'bern';
 const reply=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'private, no-store','x-content-type-options':'nosniff'}});
 if(request.method!=='GET')return reply({error:'GET erforderlich'},405);
 if(!['drainage','hazards'].includes(area)||!['bern','meikirch','blatten'].includes(location))return reply({error:'Unbekannter Bereich oder Ort'},400);
 const key='environment/v4/'+area+'/'+location+'.json';
 let previousSamples=[];
 try{const entry=await env.BUCKET?.get(key);const data=entry?await entry.json():null;previousSamples=data?.smn?.recent_samples||[];if(data&&Date.now()>=data.fetched_at&&Date.now()-data.fetched_at<180000&&!url.searchParams.has('refresh'))return reply(data);}catch{}
 const points=area==='drainage'?['bern','west','ost','belp','thun'].map(key=>ENV_POINTS[key]):[ENV_POINTS[location]],postcodes={bern:'300100',meikirch:'304500',blatten:'391400'};
 const forecastKey='environment/forecast/v1/'+(area==='drainage'?'bern-region':location)+'.json';
 const tasks={forecast:async()=>{let saved;try{const entry=await env.BUCKET?.get(forecastKey);saved=entry?await entry.json():null;}catch{}
  if(saved?.points?.length===points.length&&Number.isFinite(saved.fetched_at)&&Date.now()>=saved.fetched_at&&Date.now()-saved.fetched_at<30*60000)return saved;
  const value={...await forecast(points),fetched_at:Date.now()};try{await env.BUCKET?.put(forecastKey,JSON.stringify(value));}catch{}return value;},warnings:async()=>cleanEnvironmentWarnings(await readSource('https://app-prod-ws.meteoswiss-app.ch/v1/plzDetail?plz='+postcodes[location]+'&lang=de','json'),cleanWarnings)};
 if(area==='drainage')Object.assign(tasks,{aare_bern:async()=>parseGauge(await readSource(HYDRO_URL('2135')),'2135'),aare_thun:async()=>parseGauge(await readSource(HYDRO_URL('2030')),'2030'),canton_rain:async()=>parseCantonRain(await readSource(CANTON_URL)),smn:async()=>parseSmn(await readSource(SMN_URL),previousSamples)});
 const entries=Object.entries(tasks),results=await Promise.allSettled(entries.map(([,task])=>task())),data={area,location,fetched_at:Date.now(),errors:[],source_errors:{}};
 results.forEach((result,index)=>{const key=entries[index][0];if(result.status==='fulfilled')data[key]=result.value;else{data[key]=null;data.errors.push(key);data.source_errors[key]=String(result.reason?.message||'Quelle nicht verfügbar').slice(0,160);}});
 try{await env.BUCKET?.put(key,JSON.stringify(data),{httpMetadata:{contentType:'application/json'}});}catch{}
 return reply(data);
}
