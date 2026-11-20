/* The original winter layout, station logic and saved preferences remain independent. */
(() => {
'use strict';
const $d=selector=>document.querySelector(selector),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),num=(value,d=1)=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('de-CH',{minimumFractionDigits:d,maximumFractionDigits:d}):'Nicht verfügbar';
const clock=value=>new Date(value).toLocaleString('de-CH',{timeZone:'Europe/Zurich',weekday:'short',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+' Uhr';
const meta={winter:{subtitle:'Winterdienst & Strassenzustand',tagline:'Wetter · Strassenverhältnisse · Einsatzorientierung'},drainage:{subtitle:'Entwässerung & Gewässerlage',tagline:'Stadt Bern · Niederschlag · Aare · Kanalnetz'},hazards:{subtitle:'Naturgefahren & Unwetterlage',tagline:'Sturm · Hagel · Gewitter · Starkregen'}};
const rank={unknown:-1,green:0,yellow:1,orange:2,red:3,purple:4},names={unknown:'Nicht beurteilbar',green:'Grün',yellow:'Gelb',orange:'Orange',red:'Rot',purple:'Violett'};
const WMO_CODES=[0,1,2,3,45,48,51,53,55,56,57,61,63,65,66,67,71,73,75,77,80,81,82,85,86,95,96,99];
let area='winter',data=null,loadError='',sequence=0,controller=null,lastKey='',loading=false;
try{const saved=localStorage.getItem('meteo-discipline');if(Object.hasOwn(meta,saved))area=saved;}catch{}
const root=document.createElement('div');root.id='disciplineDashboard';root.className='discipline-grid';root.hidden=true;$d('#dashboardGrid').after(root);
const winterPalettes={green:['#eaf6ee','#bfe1c6','#4cd079','#2ea45f','#1a9b51'],yellow:['#fff9dc','#dfc45b','#ffe16a','#d3b32e','#796000'],orange:['#fff5df','#f0deb0','#ffd35f','#e1a733','#a37314'],red:['#fdecec','#f0c4c4','#f06b6b','#cc4141','#b63838'],purple:['#f5e7f4','#c790bf','#c36eb5','#863575','#76256a'],unknown:['#edf1f4','#c7d0d8','#a3afb8','#8b99a5','#526474']};
const panel=(key,title,icon,body,wide=false,open=true,state=null)=>{
 const palette=winterPalettes[state]||winterPalettes.unknown;
 return '<section class="panel dashboard-tile env-tile'+(key==='warnings'?' official-warnings':'')+'" data-env-panel="'+key+'"'+(state?' data-state="'+state+'"':'')+(wide?' data-wide="true"':'')+(key==='risk'?' style="background:'+palette[0]+';border-color:'+palette[1]+'"':'')+'><details class="tile-disclosure" data-env-disclosure="'+key+'"'+(open?' open':'')+'><summary class="tile-summary"><span class="tile-symbol" aria-hidden="true">'+icon+'</span><span class="tile-title">'+title+'</span></summary><div class="env-content">'+body+'</div></details></section>';
};
function freshness(stamp,max=3600000){const t=Date.parse(stamp);return Number.isFinite(t)&&t<=Date.now()+300000&&Date.now()-t<=max;}
function hours(point,n=12){const start=(Math.floor(Date.now()/3600000)+1)*3600000;return (point?.hours||[]).filter(p=>Date.parse(p.time)>=start).slice(0,n);}
function summary(point,n=12){
 const rows=hours(point,n),start=(Math.floor(Date.now()/3600000)+1)*3600000;
 const aligned=rows.length===n&&rows.every((p,i)=>Date.parse(p.time)===start+i*3600000);
 const rainComplete=aligned&&rows.every(p=>Number.isFinite(p.rain_mm)&&p.rain_mm>=0&&Number.isFinite(p.precip_mm)&&p.precip_mm>=0);
 const complete=rainComplete&&rows.every(p=>WMO_CODES.includes(p.code)&&Number.isFinite(p.gust_kmh)&&p.gust_kmh>=0);
 const knownRain=rows.map(p=>p.rain_mm).filter(v=>Number.isFinite(v)&&v>=0),knownGust=rows.map(p=>p.gust_kmh).filter(v=>Number.isFinite(v)&&v>=0);
 return {rows,complete,rainComplete,codeComplete:aligned&&rows.every(p=>WMO_CODES.includes(p.code)),total:rainComplete?rows.reduce((s,p)=>s+p.rain_mm,0):null,maxRain:knownRain.length?Math.max(...knownRain):null,gust:knownGust.length?Math.max(...knownGust):null,storm:rows.some(p=>[95,96,99].includes(p.code)),hail:rows.some(p=>[96,99].includes(p.code))};
}
function activeWarnings(payload,n=12){if(!payloadCurrent(payload,10*60000))return [];const until=Date.now()+n*3600000;return payload?.warnings?.items?.filter(w=>w.valid_from<until&&(w.valid_to===null||w.valid_to>Date.now()))||[];}
const warnColor=level=>({2:'yellow',3:'orange',4:'red',5:'purple'}[level]||'unknown');
function gaugeLevel(g){if(!g||!freshness(g.observed_at)||!Number.isFinite(g.discharge_m3s))return null;if(g.id!=='2135')return null;const q=g.discharge_m3s;return q>560?5:q>=500?4:q>=430?3:q>=360?2:1;}
function assess(payload,kind){
 let level='green',reasons=[],missing=[];const set=(candidate,text)=>{if(rank[candidate]>rank[level])level=candidate;reasons.push(text);};
 if(!payloadCurrent(payload))return {level:'unknown',title:'Daten nicht aktuell',reasons:['Die aktuelle Bewertung ist nicht bestätigt. Erneut laden und Quellenzeiten prüfen.']};
 if(!payload.warnings||!payloadCurrent(payload,10*60000))missing.push('amtliche Warnungen');
 const warnings=activeWarnings(payload,kind==='drainage'?6:12);
 const points=kind==='drainage'?payload.forecast?.points?.filter(p=>p.scope==='Stadtgebiet'):payload.forecast?.points;
 if(!points?.length||kind==='drainage'&&points.length!==3)missing.push('räumliche Modellprognose');
 const metrics=(points||[]).map(p=>({point:p,...summary(p,kind==='drainage'?6:12)}));
 if(metrics.some(m=>kind==='drainage'?!(m.rainComplete&&m.codeComplete):!m.complete))missing.push('vollständige Stundenprognose');
 for(const m of metrics){
  if(kind==='drainage'){
   if(m.maxRain>=10||m.total>=20)set('red',m.point.name+': '+num(m.maxRain)+' mm in der stärksten Modellstunde / '+num(m.total)+' mm in 6 h.');
   else if(m.maxRain>=5||m.total>=10)set('orange',m.point.name+': '+num(m.maxRain)+' mm/h oder '+num(m.total)+' mm in 6 h.');
   else if(m.total>=1)set('yellow',m.point.name+': '+num(m.total)+' mm in 6 h; Zuflüsse beobachten.');
   if(m.storm)set('red','Gewittersignal im Stadtgebiet: plötzliche Zuflüsse möglich. Einstieg wetterseitig zurückstellen.');
  }else{
   const wind=m.gust>=135?'purple':m.gust>=110?'red':m.gust>=90?'orange':m.gust>=70?'yellow':'green';if(wind!=='green')set(wind,'Modell-Böenspitze '+num(m.gust,0)+' km/h in den nächsten 12 h.');
   if(m.hail)set('orange','Hagelsignal im Wettermodell; Korngrösse und Eintrittswahrscheinlichkeit sind daraus nicht ableitbar.');else if(m.storm)set('orange','Gewittersignal im Wettermodell. Lokale Blitz-, Böen- und Starkregengefahr beachten.');
   const rain=m.total>=100?'purple':m.total>=60?'red':m.total>=35?'orange':m.total>=20?'yellow':'green';if(rain!=='green')set(rain,num(m.total)+' mm flüssiger Regen in 12 h.');
  }
 }
 for(const warning of warnings){if(kind==='drainage'&&!['Regen','Gewitter','Wetterwarnung'].includes(warning.title))continue;set(kind==='drainage'?(warning.title==='Gewitter'||warning.level>=3?'red':'orange'):warnColor(warning.level),'MeteoSchweiz: '+warning.title+' · amtliche Stufe '+warning.level+(warning.valid_from>Date.now()?' beginnt '+clock(warning.valid_from):' aktiv')+'.');}
 if(kind==='drainage'){
  const g=payload.aare_bern,gl=gaugeLevel(g);if(gl===null)missing.push('aktuelle Aare-Messung Bern');else if(gl>=3)set('red','Aare Bern: BAFU-Abflussklasse '+gl+' gemäss Messwert; Rückstau- und Zuflusssituation vor Ort prüfen.');else if(gl===2)set('orange','Aare Bern erreicht die Abflussschwelle der BAFU-Stufe 2.');
  if(g?.notice)set('yellow','BAFU-Messhinweis: '+g.notice);
  const m=payload.smn;if(!m||!freshness(m.observed_at,40*60000)||!Number.isFinite(m.rain_hour_mm))missing.push('aktuelle Niederschlagsmessung Bern/Zollikofen');
  else if(m.rain_hour_mm>=10)set('red','Bern/Zollikofen: '+num(m.rain_hour_mm)+' mm in den letzten 60 Messminuten.');else if(m.rain_hour_mm>=5)set('orange','Bern/Zollikofen: '+num(m.rain_hour_mm)+' mm in den letzten 60 Messminuten.');else if(m.rain_hour_mm>=1)set('yellow','Gemessener Regen in der letzten Stunde: '+num(m.rain_hour_mm)+' mm.');
 }
 if(missing.length){if(rank[level]<=0)level='unknown';reasons.push('Nicht vollständig beurteilbar: '+[...new Set(missing)].join(', ')+'. Keine Entwarnung.');}
 if(!reasons.length)reasons.push(kind==='drainage'?'Aktuell kein erhöhtes Wetter- oder Aare-Signal in den ausgewerteten Daten. Lokale Zuflüsse und Betriebszustände bleiben separat zu prüfen.':'Kein erhöhtes Signal in den ausgewerteten Warnungen und Modellstunden. Kurzfristige lokale Gewitter können dennoch entstehen.');
 return {level,title:kind==='drainage'?(level==='green'?'Wetterfenster günstig':level==='yellow'?'Zuflüsse beobachten':level==='orange'?'Einstieg kritisch prüfen':['red','purple'].includes(level)?'Einstieg wetterseitig zurückstellen':'Keine wetterseitige Beurteilung'):level==='green'?'Keine erhöhten Unwettersignale':level==='unknown'?'Lage nicht vollständig beurteilbar':'Erhöhte Unwetterlage',reasons:[...new Set(reasons)]};
}
function payloadCurrent(payload,max=15*60000){return !!payload&&Number.isFinite(payload.fetched_at)&&payload.fetched_at<=Date.now()+300000&&Date.now()-payload.fetched_at<=max;}
function pointsFor(payload,kind){return kind==='drainage'?(payload?.forecast?.points||[]).filter(p=>p.scope==='Stadtgebiet'):(payload?.forecast?.points||[]);}
function periodMetrics(rows,expected,start){
 const ordered=rows.length===expected&&Date.parse(rows[0]?.time)===start&&rows.every((p,i)=>i===0||Date.parse(p.time)===Date.parse(rows[i-1].time)+3600000);
 const rainComplete=ordered&&rows.every(p=>Number.isFinite(p.rain_mm)&&p.rain_mm>=0);
 const weatherComplete=ordered&&rows.every(p=>WMO_CODES.includes(p.code)&&Number.isFinite(p.gust_kmh)&&p.gust_kmh>=0);
 const wet=rows.filter(p=>Number.isFinite(p.rain_mm)&&p.rain_mm>=0.1),storm=rows.filter(p=>[95,96,99].includes(p.code)),hail=rows.filter(p=>[96,99].includes(p.code));
 const rain=rows.filter(p=>Number.isFinite(p.rain_mm)&&p.rain_mm>=0),wind=rows.filter(p=>Number.isFinite(p.gust_kmh)&&p.gust_kmh>=0);
 return {rows,rainComplete,codeComplete:ordered&&rows.every(p=>WMO_CODES.includes(p.code)),complete:rainComplete&&weatherComplete,total:rainComplete?rows.reduce((s,p)=>s+p.rain_mm,0):null,peakRain:rain.length?rain.reduce((a,b)=>b.rain_mm>a.rain_mm?b:a):null,peakWind:wind.length?wind.reduce((a,b)=>b.gust_kmh>a.gust_kmh?b:a):null,wet,storm,hail,snow:ordered&&rows.every(p=>Number.isFinite(p.snow_cm)&&p.snow_cm>=0)?rows.reduce((s,p)=>s+p.snow_cm,0):null};
}
function regionMetrics(payload,kind,count=24,offset=0){
 const points=pointsFor(payload,kind),metrics=points.map(point=>({point,...periodMetrics(hours(point,offset+count).slice(offset,offset+count),count,(Math.floor(Date.now()/3600000)+1+offset)*3600000)}));
 const expected=kind==='drainage'?3:1,complete=metrics.length===expected&&metrics.every(m=>kind==='drainage'?m.rainComplete&&m.codeComplete:m.complete);
 const totals=metrics.filter(m=>m.total!==null),rainPeaks=metrics.filter(m=>m.peakRain),windPeaks=metrics.filter(m=>m.peakWind);
 const maxTotal=complete&&totals.length?totals.reduce((a,b)=>b.total>a.total?b:a):null;
 const peakRain=rainPeaks.length?rainPeaks.reduce((a,b)=>b.peakRain.rain_mm>a.peakRain.rain_mm?b:a):null;
 const peakWind=windPeaks.length?windPeaks.reduce((a,b)=>b.peakWind.gust_kmh>a.peakWind.gust_kmh?b:a):null;
 const unique=key=>[...new Map(metrics.flatMap(m=>m[key]).map(row=>[row.time,row])).values()].sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
 return {metrics,complete,maxTotal,peakRain,peakWind,wet:unique('wet'),storm:unique('storm'),hail:unique('hail')};
}
function localTime(stamp){return new Date(stamp).toLocaleTimeString('de-CH',{timeZone:'Europe/Zurich',hour:'2-digit',minute:'2-digit'});}
function periodLabel(rows){
 if(!rows.length)return 'Zeitraum nicht verfügbar';const start=new Date(Date.parse(rows[0].time)-3600000).toISOString(),end=rows.at(-1).time;
 const zone=stamp=>new Intl.DateTimeFormat('de-CH',{timeZone:'Europe/Zurich',timeZoneName:'short'}).formatToParts(new Date(stamp)).find(p=>p.type==='timeZoneName')?.value;
 const stamp=zone(start)===zone(end)?clock:time=>new Date(time).toLocaleString('de-CH',{timeZone:'Europe/Zurich',weekday:'short',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZoneName:'short'})+' Uhr';
 return stamp(start)+' bis '+stamp(end);
}
function signalWindows(rows){
 if(!rows.length)return 'kein Modellsignal';const groups=[];for(const row of rows){const last=groups.at(-1);if(last&&Date.parse(row.time)-Date.parse(last.at(-1).time)===3600000)last.push(row);else groups.push([row]);}
 return groups.slice(0,3).map(periodLabel).join('; ')+(groups.length>3?' · weitere Phasen in der Detailprognose':'');
}
function lowRainPhase(payload,kind,count=24){
 const metrics=pointsFor(payload,kind).map(p=>hours(p,count));if(!payloadCurrent(payload,10*60000)||!payload?.warnings||metrics.length!==(kind==='drainage'?3:1)||metrics.some(rows=>rows.length!==count||rows.some((p,i)=>Date.parse(p.time)!==(Math.floor(Date.now()/3600000)+1+i)*3600000)))return null;
 let best=[],current=[];for(let i=0;i<count;i++){
  const first=metrics[0][i];const okay=!activeWarnings(payload,24).some(w=>['Regen','Gewitter','Wetterwarnung'].includes(w.title)&&w.valid_from<Date.parse(first.time)&&(w.valid_to===null||w.valid_to>Date.parse(first.time)-3600000))&&metrics.every(rows=>rows[i]?.time===first.time&&Number.isFinite(rows[i].rain_mm)&&rows[i].rain_mm>=0&&rows[i].rain_mm<0.1&&WMO_CODES.includes(rows[i].code)&&![95,96,99].includes(rows[i].code));
  if(okay){current.push(first);if(current.length>best.length)best=[...current];}else current=[];
 }return best.length>=2?best:null;
}
function withUnit(value,unit,d=1){return Number.isFinite(value)?num(value,d)+' '+unit:'Nicht verfügbar';}
function stat(label,value,note=''){return '<div class="situation-stat"><span>'+esc(label)+'</span><b>'+esc(value)+'</b>'+(note?'<small>'+esc(note)+'</small>':'')+'</div>';}
function briefAtGlance(payload,kind){
 const count=kind==='drainage'?6:12,now=regionMetrics(payload,kind,count),day=regionMetrics(payload,kind,24),current=payloadCurrent(payload),warningCurrent=payloadCurrent(payload,10*60000)&&!!payload?.warnings;
 const max=now.maxTotal,wind=now.peakWind?.peakWind,rain=now.peakRain?.peakRain;
 let html='<div class="situation-brief env-at-glance"><div class="situation-heading"><span aria-hidden="true">🌦️</span><h3>Lage auf einen Blick</h3></div><p class="station-note">'+(kind==='drainage'?'Entwässerung · nächste 6 Modellstunden':'Naturgefahren · nächste 12 Modellstunden')+'</p><div class="situation-stats">';
 if(kind==='drainage'){
  const gauge=payload?.aare_bern,gaugeFresh=gauge&&freshness(gauge.observed_at),observed=payload?.smn,observedFresh=observed&&freshness(observed.observed_at,40*60000);
  html+=stat('Regen 6 h',current&&max?num(max.total)+' mm':'Nicht verfügbar',max?max.point.name:'Vollständige Stadtprognose fehlt');
  html+=stat('Regen 24 h',current&&day.maxTotal?num(day.maxTotal.total)+' mm':'Nicht verfügbar','Höchste Punktsumme, kein Stadtmittel');
  html+=stat('Stärkste Modellstunde',current&&rain?(now.complete?'':'≥ ')+num(rain.rain_mm)+' mm':'Nicht verfügbar',rain?periodLabel([rain]):'');
  html+=stat('Aare · Wasserstand',gaugeFresh?withUnit(gauge.water_level_m,'m ü. M.',2):'Nicht aktuell',gaugeFresh?'Bern, Schönau · '+clock(gauge.observed_at):'Messzeit prüfen');
  html+=stat('Aare · Abfluss',gaugeFresh?withUnit(gauge.discharge_m3s,'m³/s',0):'Nicht aktuell','Flussmessung, kein Kanalnetzpegel');
  html+=stat('Gemessener Regen',observedFresh?withUnit(observed.rain_hour_mm,'mm'):'Nicht aktuell','Bern/Zollikofen · letzte 60 Messminuten');
 }else{
  html+=stat(now.complete?'Böen bis':'Böen · Teilprognose',current&&wind?(now.complete?'':'≥ ')+num(wind.gust_kmh,0)+' km/h':'Nicht verfügbar',wind?clock(wind.time):'');
  html+=stat('Regen 12 h',current&&max?num(max.total)+' mm':'Nicht verfügbar','Flüssiger Niederschlag');
  html+=stat('Stärkste Modellstunde',current&&rain?(now.complete?'':'≥ ')+num(rain.rain_mm)+' mm':'Nicht verfügbar',rain?periodLabel([rain]):'');
  html+=stat('Gewitter',!current?'Nicht aktuell':now.storm.length?'Modellsignal':now.complete?'Kein Modellsignal':'Nicht beurteilbar',current&&now.storm.length?signalWindows(now.storm):'Kurzfristige lokale Entwicklung möglich');
  html+=stat('Hagel',!current?'Nicht aktuell':now.hail.length?'Modellsignal':'Nicht ausschliessbar',now.hail.length?signalWindows(now.hail):'Keine Korngrösse / Wahrscheinlichkeit ableitbar');
  html+=stat('Amtliche Warnungen',warningCurrent?String(activeWarnings(payload,count).length):'Nicht verfügbar',warningCurrent?'Zeitraum der Ampel':'Kein bestätigter aktueller Warnstand');
 }
 html+='</div>';
 if(!current||!now.complete)html+='<p class="env-coverage">Lage nur teilweise beurteilbar. Fehlende oder veraltete Werte sind keine Entwarnung.</p>';
 if(current&&now.storm.length)html+='<p><b>Gewitterphase im Modell:</b> '+esc(signalWindows(now.storm))+'. Radar und kurzfristige amtliche Warnungen verfolgen.</p>';
 if(kind==='drainage'&&payload?.aare_bern?.notice)html+='<p class="env-note">BAFU-Messhinweis: '+esc(payload.aare_bern.notice)+'</p>';
 return html+'</div>';
}
function planningBlock(payload,kind,offset){
 const region=regionMetrics(payload,kind,6,offset),rows=region.metrics[0]?.rows||[];let color='green';const raise=c=>{if(rank[c]>rank[color])color=c;};
 for(const m of region.metrics)for(const row of m.rows)raise(hourlyColor(row,{...payload,forecast:{...payload?.forecast,points:[m.point]}},kind));
 const from=rows[0]?Date.parse(rows[0].time)-3600000:null,to=rows.at(-1)?Date.parse(rows.at(-1).time):null;
 const warnings=payloadCurrent(payload,10*60000)?activeWarnings(payload,24).filter(w=>from!==null&&w.valid_from<to&&(w.valid_to===null||w.valid_to>from)):[];
 for(const w of warnings){if(kind==='drainage'&&!['Regen','Gewitter','Wetterwarnung'].includes(w.title))continue;raise(kind==='drainage'?(w.title==='Gewitter'||w.level>=3?'red':'orange'):warnColor(w.level));}
 if((!region.complete||!payloadCurrent(payload)||(!payload?.warnings||!payloadCurrent(payload,10*60000)))&&color==='green')color='unknown';
 return {region,rows,color,warnings,offset,warningAvailable:!!payload?.warnings&&payloadCurrent(payload,10*60000)};
}
function outlook24(payload,kind){
 const current=payloadCurrent(payload),region=regionMetrics(payload,kind,24),wet=region.wet,phase=lowRainPhase(payload,kind),wind=region.peakWind?.peakWind,peak=region.peakRain?.peakRain;
 const warnings=payloadCurrent(payload,10*60000)&&payload?.warnings?activeWarnings(payload,24):null;
 let html='<div class="env-day-report"><p class="station-note">24 Modellstunden · Schweizer Zeit · 1 mm Regen = 1 l/m² · '+esc(payload?.forecast?.model||'Prognosequelle nicht verfügbar')+(payload?.forecast?.fetched_at?' · Wetterdaten abgerufen '+clock(payload.forecast.fetched_at):'')+'</p>';
 if(!payload?.forecast)html+='<p class="env-unavailable">'+esc(payload?.source_errors?.forecast||'Wetterquelle vorübergehend nicht erreichbar.')+' Fehlende Daten bedeuten keine Entwarnung.</p>';
 if(!current||!region.complete)html+='<p class="env-unavailable">Der 24-Stunden-Lagebericht ist nicht vollständig verfügbar. Bekannte erhöhte Signale bleiben sichtbar, fehlende Stunden werden nicht zu null ergänzt.</p>';
 if(current&&region.maxTotal){
  if(kind==='drainage')html+='<p>Im Stadtgebiet werden am regenreichsten Modellpunkt <b>'+num(region.maxTotal.total)+' mm in 24 Stunden</b> erwartet ('+esc(region.maxTotal.point.name)+'). '+(peak?'Die stärkste Modellstunde bringt '+num(peak.rain_mm)+' mm: '+esc(periodLabel([peak]))+'.':'')+'</p>';
  else html+='<p>Am ausgewählten Ort werden <b>'+num(region.maxTotal.total)+' mm flüssiger Regen in 24 Stunden</b> erwartet. '+(wind?'Die höchste Modell-Böenspitze liegt bei <b>'+num(wind.gust_kmh,0)+' km/h</b>, '+esc(clock(wind.time))+'.':'')+'</p>';
 }
 if(current&&!region.complete&&(wind||peak))html+='<p>Die verfügbaren Modellstunden zeigen: '+(wind?'Böen bis mindestens '+num(wind.gust_kmh,0)+' km/h. ':'')+(peak?'Stündlicher Regen bis mindestens '+num(peak.rain_mm)+' mm.':'')+' Ein vollständiges 24-Stunden-Maximum ist nicht bestätigt.</p>';
 if(current&&wet.length)html+='<p><b>Regenphasen ab 0,1 mm je Modellstunde:</b> '+esc(signalWindows(wet))+'.</p>';else if(current&&region.complete)html+='<p>Die vollständigen Modellstunden zeigen keinen Regen ab 0,1 mm je Stunde. Kurzfristige lokale Schauer bleiben möglich.</p>';
 if(current&&region.storm.length)html+='<p><b>Gewitterphase:</b> '+esc(signalWindows(region.storm))+'. '+(kind==='drainage'?'Plötzliche Zuflüsse sind möglich; keine Einstiegsfreigabe aus dieser Prognose ableiten.':'Blitze, Böen und Starkregen können örtlich eng begrenzt auftreten.')+'</p>';
 if(current&&region.hail.length)html+='<p><b>Hagelsignal:</b> '+esc(signalWindows(region.hail))+'. Korngrösse und örtliche Wahrscheinlichkeit sind nicht verfügbar.</p>';
 if(kind==='drainage'&&current&&phase)html+='<p><b>Längste modellierte Phase mit wenig Regen:</b> '+esc(periodLabel(phase))+' ('+phase.length+' Modellstunden unter 0,1 mm je Stunde an allen drei Stadtpunkten, ohne Gewittersignal). Dies ist kein sicheres Arbeitsfenster und keine Freigabe.</p>';
 html+='<p><b>Amtliche Warnungen in 24 Stunden:</b> '+(warnings===null?'Aktueller Warnstand nicht bestätigt.':warnings.length?warnings.map(w=>esc(w.title)+' Stufe '+w.level+' ('+esc(clock(w.valid_from))+' bis '+(w.valid_to?esc(clock(w.valid_to)):'auf Weiteres')+')').join('; '):'Keine Warnung im abgerufenen Stand. Kurzfristige Warnungen weiterhin verfolgen.')+'</p>';
 const snow=region.metrics.filter(m=>m.snow!==null&&m.snow>0);if(current&&snow.length)html+='<p><b>Fester Niederschlag:</b> Bis '+num(Math.max(...snow.map(m=>m.snow)))+' cm modellierter Neuschnee am regen-/schneereichsten Punkt. Schneeschmelze aus einer vorhandenen Schneedecke wird hier nicht berechnet.</p>';
 if(kind==='drainage')html+='<p class="env-coverage">Die Pegelkarten zeigen den aktuellen Aarestand. Dieser Bericht enthält keine Aarepegel- oder Kanalabflussprognose. Belp und Thun sind regionaler Kontext; Fluss-Laufzeiten und örtliche Rückstausituationen werden nicht aus Punktregen geschätzt.</p>';
 html+='</div><div class="forecast-strip env-outlook-strip">';
 for(const offset of [0,6,12,18]){
  const block=planningBlock(payload,kind,offset),m=block.region,max=m.maxTotal,peakWind=m.peakWind?.peakWind,peakRain=m.peakRain?.peakRain;
  html+='<article class="fcard env-planning-card" data-level="'+block.color+'"><div class="slot">'+(block.rows.length?esc(periodLabel(block.rows)):'Zeitraum nicht verfügbar')+'</div><div class="ficon" aria-hidden="true">'+(m.storm.length?'⛈️':max?.total>0?'🌧️':'☁️')+'</div><div class="temp">'+(kind==='drainage'?(current?withUnit(max?.total,'mm'):'Nicht aktuell'):(current?withUnit(peakWind?.gust_kmh,'km/h',0):'Nicht aktuell'))+'</div><div class="fmeta">'+(kind==='drainage'?'Höchste 6-h-Punktsumme im Stadtgebiet':m.complete?'Höchste Böenspitze im Zeitfenster':'Bekannte Böenspitze · Daten teilweise')+'</div><div class="fmeta">'+(kind==='drainage'?'Stärkste Stunde: '+num(peakRain?.rain_mm)+' mm':'Regen 6 h: '+num(max?.total)+' mm')+'</div><div class="fmeta">'+(m.storm.length?'Gewittersignal':m.complete?'Kein Gewittersignal im Modell':'Prognose unvollständig')+(m.hail.length?' · Hagelsignal':'')+'</div><div class="fmeta">'+(block.warnings.length?block.warnings.map(w=>esc(w.title)+' Stufe '+w.level).join(' · '):block.warningAvailable?'Keine Warnung im abgerufenen Stand':'Warnstand nicht bestätigt')+'</div><span class="pill '+block.color+'">'+names[block.color]+' · '+(block.color==='unknown'?'Daten unbestätigt':'Planungshinweis')+'</span></article>';
 }
 html+='</div><p class="station-note">Vier 6-Stunden-Fenster zur Planung. Regenfarben in Naturgefahren beziehen sich auf das zugehörige 12-Stunden-Fenster; Böen und Gewittersignale auf die jeweilige Stunde. Aktuelle Pegel und Messungen werden nicht als zukünftige Werte fortgeschrieben.</p>';
 return html+'<details class="model-details" data-env-disclosure="hourly-details"><summary>24 Stunden · Detailwerte öffnen</summary>'+hourly(payload||{},kind)+'</details>';
}

function riskPanel(result,kind,payload){
 const palette=winterPalettes[result.level]||winterPalettes.unknown;
 return '<div class="ampel env-risk" data-level="'+result.level+'"><div class="warning-origin">'+(kind==='drainage'?'DASHBOARD-BEWERTUNG · KANALNETZ · NÄCHSTE 6 STUNDEN':'DASHBOARD-BEWERTUNG · UNWETTER · NÄCHSTE 12 STUNDEN')+'</div><div class="ampel-main"><div class="light" aria-hidden="true" style="background:radial-gradient(circle at 35% 35%,'+palette[2]+' 0 35%,'+palette[3]+' 36% 100%)"></div><div><div class="ampel-status" style="color:'+palette[4]+'">'+(result.level==='unknown'?'OFFEN':names[result.level].toUpperCase())+'</div><div class="env-ampel-explanation">'+esc(result.title)+'</div></div></div><p class="env-risk-description" style="color:'+palette[4]+'">'+result.reasons.map(esc).join('<br>')+'</p><details class="ampel-criteria warning-legends" data-env-disclosure="risk-rules"><summary>Farben und Bewertungsgrundlage</summary>'+rules(kind)+'</details>'+briefAtGlance(payload,kind)+(kind==='drainage'?'<div class="situation-brief env-entry-note"><div class="situation-heading"><span aria-hidden="true">🛡️</span><h3>Betriebliche Freigabe</h3></div><p><b>Keine Einstiegsfreigabe.</b> Freimessen / Gasmessung, Lüftung, Sicherung und Rettung sowie die Freigabe der verantwortlichen Betriebsstelle bleiben erforderlich. Ein Aarepegel misst keinen Kanalwasserstand.</p></div>':'')+'</div>';
}
function warningPanel(payload){
 const items=activeWarnings(payload),available=!!payload?.warnings&&payloadCurrent(payload,10*60000);
 const colors={2:'Gelb',3:'Orange',4:'Rot',5:'Violett'};
 const origin='<div class="warning-origin">AMTLICHE WARNUNGEN · WARNREGION DES GEWÄHLTEN ORTES</div>';
 const status=!available?'Warnungen nicht verfügbar. Eine Entwarnung ist derzeit nicht möglich.':items.length?items.length+' amtliche Wetterwarnung'+(items.length===1?'':'en')+' im betrachteten 12-Stunden-Zeitfenster.':'Keine aktuellen MeteoSchweiz-Wetterwarnungen im betrachteten 12-Stunden-Zeitfenster.';
 const others=area==='hazards'&&available?(payload.warnings.other_items||[]).filter(w=>w.valid_from<Date.now()+24*3600000&&(w.valid_to===null||w.valid_to>Date.now())):[];
 const otherHtml=others.length?'<details class="model-details" data-env-disclosure="other-federal"><summary>Weitere Bundesmeldungen ausserhalb der Unwetter-Ampel ('+others.length+')</summary><p class="station-note">Diese Meldungen stammen von anderen Bundesfachstellen und sind keine MeteoSchweiz-Wetterwarnungen. Ihre Stufen werden nicht mit der Sturm-/Regenampel verrechnet.</p>'+others.map(w=>'<article class="official-warning" data-level="'+Number(w.level)+'"><h3>'+esc(w.title)+' · Stufe '+w.level+'</h3><p class="validity">'+clock(w.valid_from)+(w.valid_to?' bis '+clock(w.valid_to):' · auf Weiteres')+'</p>'+(w.text?'<p class="warning-text">'+esc(w.text)+'</p>':'')+'<p class="station-note">'+esc(w.source)+' · <a target="_blank" rel="noopener" href="'+esc(w.url)+'">Offizielles Bulletin / Details öffnen</a></p></article>').join('')+'</details>':'';
 return origin+'<p class="official-warnings-status" role="status" aria-live="polite">'+status+'</p><div class="official-warning-list">'+items.map(w=>'<article class="official-warning" data-level="'+Number(w.level)+'"><h3>'+esc(w.icon)+' '+esc(w.title)+' · Stufe '+Number(w.level)+' / 5 · '+colors[w.level]+(w.outlook?' · Vorwarnung':'')+'</h3><p class="validity">'+(w.valid_from>Date.now()?'Angekündigt · Beginn':'Gültig ab')+' '+clock(w.valid_from)+(w.valid_to?' bis '+clock(w.valid_to):' · bis auf Widerruf')+'</p><p class="warning-text">'+esc(w.text.replace(/<[^>]+>/g,' '))+'</p></article>').join('')+'</div><div class="warning-legend" aria-label="Amtliche Gefahrenstufen"><span class="yellow">Stufe 2 · Gelb</span><span class="orange">Stufe 3 · Orange</span><span class="red">Stufe 4 · Rot</span><span class="purple">Stufe 5 · Violett</span></div><p class="station-note">Quelle: MeteoSchweiz · Warnregion '+esc(payload?.location==='meikirch'?'Meikirch':payload?.location==='blatten'?'Blatten bei Naters':'Bern')+(payload?' · Geprüft: '+clock(payload.fetched_at):'')+'</p>'+otherHtml;
}
function quantity(value,unit,d=1){return Number.isFinite(value)?num(value,d)+' '+unit:'Nicht verfügbar';}
function quality(stamp,max){return '<span class="env-quality '+(freshness(stamp,max)?'fresh':'stale')+'">'+(freshness(stamp,max)?'Quelle aktuell':'Quelle veraltet / unbestätigt')+' · '+clock(stamp)+'</span>';}
function gaugeCard(g,id){if(!g)return '<article class="env-measure"><h3>Aare · '+(id==='2135'?'Bern, Schönau':'Thun')+'</h3><p class="env-unavailable">Messwerte derzeit nicht verfügbar.</p></article>';const level=gaugeLevel(g);return '<article class="env-measure"><span class="env-kind-label">MESSUNG · BEOBACHTET</span><h3>'+esc(g.name)+' <small>'+g.id+'</small></h3>'+quality(g.observed_at,3600000)+'<div class="env-two-values"><div><small>Wasserstand</small><b>'+num(g.water_level_m,2)+' <em>m ü. M.</em></b></div><div><small>Abfluss</small><b>'+num(g.discharge_m3s,0)+' <em>m³/s</em></b></div></div>'+(level!==null?'<p class="env-class" data-level="'+(level===1?'green':warnColor(level))+'">Abflussklasse '+level+' nach BAFU-Schwellen · ab 360 m³/s Stufe 2</p>':'')+(g.history_24h?'<p class="station-note"><b>Gemessene Spanne der letzten 24 h:</b><br>Wasserstand '+num(g.history_24h.min?.water_level_m,2)+' bis '+num(g.history_24h.max?.water_level_m,2)+' m ü. M.<br>Abfluss '+num(g.history_24h.min?.discharge_m3s,0)+' bis '+num(g.history_24h.max?.discharge_m3s,0)+' m³/s · keine Vorhersage</p>':'')+(g.notice?'<p class="env-note">'+esc(g.notice)+'</p>':'')+'<p class="station-note"><a target="_blank" rel="noopener" href="'+esc(g.url)+'">BAFU · Station und Verlauf öffnen</a></p></article>';}
function rainMeasurements(payload){const m=payload.smn;let out='<article class="env-measure"><span class="env-kind-label">MESSUNG · BEOBACHTET</span><h3>🌧️ Bern / Zollikofen · Bund</h3>'+(m?quality(m.observed_at,40*60000)+'<div class="env-two-values"><div><small>Letzte 10 Messminuten</small><b>'+num(m.rain_10min_mm)+' <em>mm</em></b></div><div><small>Letzte 60 Messminuten</small><b>'+num(m.rain_hour_mm)+' <em>mm</em></b></div></div><p class="station-note">Quelle: MeteoSchweiz SwissMetNet · 60 Minuten nur bei sechs lückenlosen 10-Minuten-Werten. Stationsmessung, kein flächiger Stadtmittelwert.</p>':'<p class="env-unavailable">Messung derzeit nicht verfügbar.</p>')+'</article>';
 const stationCard=(id,fallback)=>{
  const r=payload.canton_rain?.find(r=>r.id===id);
  return '<article class="env-measure"><span class="env-kind-label">MESSUNG · BEOBACHTET</span><h3>'+esc(r?.name||fallback)+'</h3>'+(r?quality(r.observed_at,3600000)+'<strong>'+num(r.value_mmh)+' mm/h</strong><small>'+esc(r.station_code||r.id)+' · '+esc(r.source)+'</small>':'<p class="env-unavailable">Messwerte derzeit nicht verfügbar.</p>')+'</article>';
 };
 out+='<h3>Niederschlagsstationen · Region Bern</h3><div class="env-reference-grid rain-reference-grid">'+stationCard('5530','Mühleberg')+stationCard('5790','Laupen')+stationCard('5510','Belp')+'</div><p class="station-note">MeteoSchweiz-Messwerte aus der Niederschlagstabelle des Kantons Bern. Einheit gemäss Quelle: mm/h. Diese regionalen Quellwerte werden nicht mit der eigenen 60-Minuten-Summe aus Bern/Zollikofen gleichgesetzt und nicht direkt als Kanalzuflüsse gewertet.</p>';
 out+='<details class="model-details" data-env-disclosure="rain-more"><summary>Weitere kantonale Referenzen · Krauchthal</summary><div class="env-reference-grid">'+stationCard('R011','Krauchthal, Lindenfeld')+stationCard('R012','Krauchthal, Dieterswald')+'</div></details>';return out;
}
function pointTable(payload){const points=payload.forecast?.points||[];return '<p class="station-note">'+esc(payload.forecast?.model||'Modell nicht verfügbar')+' · 1 mm = 1 l/m². Punktprognosen für räumliche Orientierung, keine vermessenen Kanal-Teileinzugsgebiete.</p><div class="horizontal-scroll"><table><thead><tr><th>Modellpunkt</th><th>Regen 6 h (mm)</th><th>Regen 12 h (mm)</th><th>Stärkste Stunde (mm)</th></tr></thead><tbody>'+points.map(p=>{const six=summary(p,6),twelve=summary(p,12);return '<tr><td><b>'+esc(p.name)+'</b><small class="env-table-note">'+esc(p.scope||'Ausgewählter Ort')+'</small></td><td>'+num(six.total)+'</td><td>'+num(twelve.total)+'</td><td>'+num(twelve.maxRain)+'</td></tr>';}).join('')+'</tbody></table></div><p class="station-note">Belp und Thun beschreiben den regionalen Aare-Kontext oberhalb Bern. Ihre Regenmengen sind keine direkten Zuflüsse zum städtischen Kanalnetz. Auch bei unauffälligem Aarestand kann lokaler Starkregen Oberflächenabfluss und Rückstau auslösen.</p>';}
function hourlyColor(row,payload,kind){
 if(!payloadCurrent(payload))return 'unknown';
 let color='green';const raise=value=>{if(rank[value]>rank[color])color=value;};
 const count=kind==='drainage'?6:12,all=hours(payload.forecast?.points?.[0],24),index=all.findIndex(p=>p.time===row.time),start=Math.floor(index/count)*count,event=all.slice(start,start+count);
 const amount=event.length===count&&event.every((p,i)=>Number.isFinite(p.rain_mm)&&p.rain_mm>=0&&Date.parse(p.time)===Date.parse(event[0].time)+i*3600000)?event.reduce((sum,p)=>sum+p.rain_mm,0):null;
 if(!Number.isFinite(row.precip_mm)||!Number.isFinite(row.rain_mm)||!Number.isFinite(row.gust_kmh)||!WMO_CODES.includes(row.code))return 'unknown';
 if(kind==='drainage'){
  if([95,96,99].includes(row.code)||row.rain_mm>=10)raise('red');else if(row.rain_mm>=5)raise('orange');else if(row.rain_mm>=1)raise('yellow');
  if(row.rain_mm>0&&amount!==null)raise(amount>=20?'red':amount>=10?'orange':amount>=1?'yellow':'green');
 }else{
  raise(row.gust_kmh>=135?'purple':row.gust_kmh>=110?'red':row.gust_kmh>=90?'orange':row.gust_kmh>=70?'yellow':'green');
  if([95,96,99].includes(row.code))raise('orange');
  if(row.rain_mm>0&&amount!==null)raise(amount>=100?'purple':amount>=60?'red':amount>=35?'orange':amount>=20?'yellow':'green');
 }return color;
}
function hourly(payload,kind){const point=payload.forecast?.points?.[0],m=summary(point,12);if(!point)return '<p class="env-unavailable">Stundenprognose nicht verfügbar.</p>';const rows=hours(point,24);return '<p class="station-note">'+esc(payload.forecast.model)+' · '+esc(point.name)+' · '+(kind==='drainage'?'Stadtmitte, ergänzend zur räumlichen Übersicht. Zeiten bezeichnen das Ende der jeweiligen Modellstunde.':'Böen sind Modellspitzen, keine Messungen. Hagelsignale liefern keine Korngrösse. Zeiten bezeichnen das Ende der jeweiligen Modellstunde.')+'</p><div class="env-rain-strip" aria-label="Niederschlagsprognose nächste zwölf Stunden">'+rows.slice(0,12).map(r=>'<div><span>'+new Date(r.time).toLocaleTimeString('de-CH',{timeZone:'Europe/Zurich',hour:'2-digit',minute:'2-digit'})+'</span><i style="--rain-height:'+Math.min(64,Math.max(2,(r.precip_mm||0)*9))+'px"'+(!Number.isFinite(r.precip_mm)?' class="missing"':'')+'></i><b>'+num(r.precip_mm)+'</b></div>').join('')+'</div><div class="horizontal-scroll"><table><thead><tr><th>Zeit · Schweizer Zeit</th><th>Wetter</th><th>Gesamtniederschlag (mm)</th><th>Regen (mm)</th><th>Böen (km/h)</th></tr></thead><tbody>'+rows.map(r=>{const color=hourlyColor(r,payload,kind);return '<tr data-level="'+color+'"><td>'+clock(r.time)+(color!=='green'?'<small class="env-table-note">'+names[color]+' · Modellsignal dieser Stunde</small>':'')+'</td><td>'+esc(WMO_CODES.includes(r.code)?weatherInfo(r.code)[0]+' '+weatherInfo(r.code)[1]:'❔ Nicht verfügbar')+'</td><td>'+num(r.precip_mm)+'</td><td>'+num(r.rain_mm)+'</td><td>'+num(r.gust_kmh,0)+'</td></tr>';}).join('')+'</tbody></table></div>';}
function hazardCards(payload){if(!payloadCurrent(payload))return '<p class="env-unavailable">Aktuelle Gefahrenübersicht nicht verfügbar. Keine Entwarnung.</p>';const m=summary(payload.forecast?.points?.[0],12);return '<p class="station-note"><b>PROGNOSE · nächste 12 Stunden.</b> '+esc(payload.forecast?.model||'Wettermodell nicht verfügbar')+'. Die folgenden Werte sind Modellberechnungen, keine Stationsmessungen.</p><div class="env-hazard-grid"><article class="env-measure"><span class="env-big-icon">🌬️</span><h3>Sturm / Böen</h3><strong>'+quantity(m.gust,'km/h',0)+'</strong><p>Höchste Modell-Böenspitze in 12 Stunden.</p></article><article class="env-measure"><span class="env-big-icon">⛈️</span><h3>Gewitter / Blitz</h3><strong>'+(m.storm?'Modellsignal vorhanden':!m.complete?'Nicht beurteilbar':'Kein Modellsignal')+'</strong><p>Kurzfristige Entwicklung im Radar und in amtlichen Warnungen verfolgen.</p></article><article class="env-measure"><span class="env-big-icon">🧊</span><h3>Hagel</h3><strong>'+(m.hail?'Modellsignal vorhanden':!m.complete?'Nicht beurteilbar':'Keine belastbare Hagelprognose')+'</strong><p>Kein Modellsignal schliesst Hagel nicht aus. Das Modell liefert keine belastbare Korngrösse oder örtliche Eintrittswahrscheinlichkeit.</p></article><article class="env-measure"><span class="env-big-icon">🌧️</span><h3>Unwetterregen</h3><strong>'+quantity(m.total,'mm / 12 h')+'</strong><p>Stärkste Modellstunde: '+quantity(m.maxRain,'mm')+'. Flüssiger Regen. Fester Niederschlag bleibt davon getrennt.</p></article></div>';}
function radar(kind,place){const lat=place.lat,lon=place.lon,base='https://embed.windy.com/embed2.html?lat='+lat+'&lon='+lon+'&detailLat='+lat+'&detailLon='+lon+'&zoom=7&level=surface&marker=true&metricRain=mm&metricTemp=%C2%B0C';return panel('radar','Wetterradar · Niederschlag','📡','<iframe class="radar-frame" loading="lazy" title="Niederschlagsradar '+esc(place.name)+'" src="'+base+'&overlay=radar&product=radar"></iframe><p class="station-note">Windy-Radar · Bildzeit und Produkt in der Karte beachten. Räumliche Orientierung, keine Messung des Kanalzuflusses.</p>')+panel('rainmap','Niederschlagsmenge · Modellkarte','🌧️','<iframe class="radar-frame" loading="lazy" title="Niederschlagsmengenkarte '+esc(place.name)+'" src="'+base+'&overlay=rainAccu&product=ecmwf"></iframe><p class="station-note">Windy / ECMWF · Zeitraum in der Karte beachten. Die Kartensteuerung kann einen anderen Zeitraum als die Tabellen anzeigen.</p>');}
function sourceHealth(payload,kind){
 const rows=[['Wettermodell',payloadCurrent(payload)&&regionMetrics(payload,kind,24).complete,(payload?.forecast?.model||'nicht verfügbar')+(payload?.forecast?(regionMetrics(payload,kind,24).complete?' · 24 h vollständig':' · 24 h unvollständig'):'')],['MeteoSchweiz-Warnungen',payloadCurrent(payload,10*60000)&&!!payload?.warnings,payload?.fetched_at?'Abruf '+clock(payload.fetched_at):'kein bestätigter Abruf']];
 if(kind==='drainage'){
  for(const [key,label] of [['aare_bern','Aare · Bern, Schönau'],['aare_thun','Aare · Thun']]){const g=payload?.[key];rows.push([label,!!g&&freshness(g.observed_at),g?clock(g.observed_at)+(g.notice?' · Quellenhinweis vorhanden':''):'Messung fehlt']);}
  const smn=payload?.smn;rows.push(['Regen · Bern/Zollikofen',!!smn&&freshness(smn.observed_at,40*60000)&&Number.isFinite(smn.rain_hour_mm),smn?clock(smn.observed_at)+(smn.rain_hour_mm===null?' · 60-Minuten-Summe unvollständig':''):'Messung fehlt']);
  const current=(payload?.canton_rain||[]).filter(r=>freshness(r.observed_at));rows.push(['Kantonale Niederschlagstabelle',current.length===5,current.length+' von 5 Referenzstationen aktuell']);
 }
 return '<div class="env-source-health"><h3>Aktueller Quellenstatus</h3><div class="horizontal-scroll"><table><thead><tr><th>Datenquelle</th><th>Status</th><th>Stand / Hinweis</th></tr></thead><tbody>'+rows.map(([label,okay,note])=>'<tr><td>'+esc(label)+'</td><td class="'+(okay?'env-source-fresh':'env-source-missing')+'">'+(okay?'Verfügbar':'Nicht bestätigt / unvollständig')+'</td><td>'+esc(note)+'</td></tr>').join('')+'</tbody></table></div></div>';
}
function sources(kind,payload){return sourceHealth(payload,kind)+ '<div class="sources"><div class="source-box"><b>Bund · MeteoSchweiz</b>Amtliche Warnungen nach Warnregion. ICON-Modell über Open-Meteo; bei Ausfall als solcher gekennzeichneter ECMWF-Ersatz. <a target="_blank" rel="noopener" href="https://www.meteoschweiz.admin.ch/service-und-publikationen/applikationen/gefahren.html">Warnkarte</a> · <a target="_blank" rel="noopener" href="https://open-meteo.com/en/docs">Modell- und Wettercode-Dokumentation</a></div>'+(kind==='drainage'?'<div class="source-box"><b>Bund · BAFU</b>Aare Bern-Schönau (2135) und Aare Thun (2030). Messzeit und Qualitätshinweise werden übernommen. Flusswerte sind keine Kanalnetzpegel. Die gemessene 24-h-Spanne ist keine Vorhersage. <a target="_blank" rel="noopener" href="https://www.hydrodaten.admin.ch/de/erlauterungen-zu-den-vorhersage-plots">BAFU: Einordnung hydrologischer Vorhersagen</a></div><div class="source-box"><b>Kanton Bern · AWA</b>Niederschlagsmessungen Mühleberg (MUB), Laupen (LAP), Belp (BEP) und kantonale Referenzen aus der <a target="_blank" rel="noopener" href="https://www.wada.sites.be.ch/wasserdaten/wasser/liste_ns/liste_ns.html">kantonalen Tabelle</a>. <a target="_blank" rel="noopener" href="https://www.rm.hochwasser-be.ch/">Regionalmodul Aare / Hochwasserinformationen</a></div><div class="source-box"><b>Stadt Bern und Suva · Arbeitssicherheit</b><a target="_blank" rel="noopener" href="https://www.bern.ch/themen/planen-und-bauen/bern-baut/bewilligungen-tiefbauamt/arbeitshilfen/abwasseranlagen/weisung-personensicherheit-in-abwasseranlagen-2018.pdf/download">Stadt Bern: Personensicherheit in Abwasseranlagen</a> · <a target="_blank" rel="noopener" href="https://www.suva.ch/de-ch/download/dokument/sicher-arbeiten-in-schaechten--gruben-und-kanaelen/sicher-arbeiten-in-schaechten--gruben-und-kanaelen--44062.d">Suva: Sicheres Arbeiten in Schächten und Kanälen</a>. Betriebliche Vorgaben und lokale Freigaben bleiben massgebend. <a target="_blank" rel="noopener" href="https://www.bafu.admin.ch/de/oberflaechenabfluss">BAFU: Gefährdungskarte Oberflächenabfluss</a> als statische Planungshilfe, keine aktuelle Regen- oder Kanalprognose.</div>':'<div class="source-box"><b>Einordnung von Sturm und Gewitter</b><a target="_blank" rel="noopener" href="https://www.meteoschweiz.admin.ch/wetter/gefahren/erlaeuterungen-der-gefahrenstufen/wind.html">MeteoSchweiz: Wind</a> · <a target="_blank" rel="noopener" href="https://www.meteoschweiz.admin.ch/wetter/gefahren/erlaeuterungen-der-gefahrenstufen/gewitter.html">MeteoSchweiz: Gewitter</a>. Hagel wird nur als Signal beschrieben, nicht als gesicherte örtliche Vorhersage.</div>')+'</div>';}
function measurementGuide(kind){
 return '<div class="env-data-guide"><div class="source-box"><b>📍 Messung oder Prognose?</b><p>'+(kind==='drainage'?'Niederschlagsstationen und Aarepegel zeigen beobachtete Werte zum angegebenen Messzeitpunkt. Regenmengen in der räumlichen Übersicht und im 24-Stunden-Ausblick sind Modellprognosen.':'Böen, Regen, Gewitter und Hagelsignale sind Modellprognosen für den gewählten Ort. Hier werden keine aktuellen örtlichen Wind- oder Hagelmessungen dargestellt.')+'</p></div><div class="source-box"><b>🕒 Abrufzeit und Messzeit</b><p>Die letzte Aktualisierung im Header bezeichnet den Abruf der Bereichsdaten. Einzelne Quellen können aus dem Zwischenspeicher stammen. Die Messzeit an einer Station zeigt, wann tatsächlich gemessen wurde. Quellenzeiten und den Modellabruf im 24-Stunden-Ausblick beachten. Es gibt keine automatischen Datenabrufe.</p></div><div class="source-box"><b>🌧️ Einheiten und Zeiträume</b><p>1 mm Niederschlag entspricht 1 Liter pro Quadratmeter. mm/h bezeichnet eine Niederschlagsrate; mm in 6, 12 oder 24 Stunden eine Menge über diesen Zeitraum. Böen werden in km/h angegeben.'+(kind==='drainage'?' m ü. M. ist die Höhe des Wasserstands über Meer. 1 m³/s Abfluss entspricht 1’000 Litern pro Sekunde.':'')+' Tabellenzeiten sind Schweizer Zeit und bezeichnen das Ende der jeweiligen Modellstunde.</p></div><div class="source-box"><b>🚦 Farben und Datenqualität</b><p>Die Ampel verbindet bekannte erhöhte Signale mit amtlichen Warnungen. Ihre Schwellen stehen unter «Farben und Bewertungsgrundlage». Amtliche Warnungen behalten ihre eigene Gefahrenstufe. '+(kind==='drainage'?'«Quelle aktuell» gilt für Aare und kantonale Stationen bis 60 Minuten, für Bern/Zollikofen bis 40 Minuten. Eine vollständige 60-Minuten-Summe benötigt sechs lückenlose Messwerte. ':'')+'Bereichsdaten gelten höchstens 15 Minuten, Warnungsabrufe höchstens 10 Minuten als aktuell. Fehlende Werte sind keine Nullwerte, Grau ist keine Entwarnung. Zum erneuten Prüfen «Aktualisieren» wählen.</p></div></div>';
}
function updateHeader(payload){
 $d('#todayLabel').textContent=new Date().toLocaleDateString('de-CH',{timeZone:'Europe/Zurich',weekday:'long',day:'numeric',month:'long',year:'numeric'});
 $d('#lastUpdate').textContent=payload?.fetched_at?'Letzte Aktualisierung: '+new Date(payload.fetched_at).toLocaleString('de-CH',{timeZone:'Europe/Zurich'}):'Letzte Aktualisierung: nicht verfügbar';
 const status=loading?'Bereichsdaten werden geladen.':loadError?'Datenabruf fehlgeschlagen. Bitte erneut aktualisieren.':!payload?'Bereichsdaten nicht verfügbar.':!payloadCurrent(payload)?'Datenstand veraltet. Bitte aktualisieren.':payload.errors?.length?'Daten teilweise verfügbar. Quellenstatus beachten.':'Daten aktualisiert: '+new Date(payload.fetched_at).toLocaleString('de-CH',{timeZone:'Europe/Zurich',weekday:'short',hour:'2-digit',minute:'2-digit',second:'2-digit'})+' Uhr.';
 $d('#weatherRefreshStatus').textContent=status;
}
function rules(kind){return kind==='drainage'?'<p><b>Eigene konservative Screening-Regeln, keine amtlichen Kanalnetz-Grenzwerte:</b> Gelb ab 1 mm in 6 Modellstunden oder 1 mm in 60 Messminuten. Orange ab 5 mm in einer Modellstunde, 10 mm in 6 Modellstunden oder 5 mm in 60 Messminuten. Rot ab 10 mm in einer Modellstunde, 20 mm in 6 Modellstunden, 10 mm in 60 Messminuten oder Gewittersignal. Bewertet wird der höchste Wert der drei Stadt-Modellpunkte, kein Stadtmittel.</p><p>Aktive oder in 6 h beginnende Regen-/Gewitterwarnungen erhöhen die Stufe; Gewitter und amtliche Regenstufe ab 3 erhalten Rot. Aare Bern: BAFU-Abflussklasse 2 Orange, ab 3 Rot. Die Klasse beschreibt nur den Flussabfluss, keine amtliche Kanal-Freigabe. Ein Quellenhinweis erhöht mindestens auf Gelb. Fehlende Pflichtdaten ergeben Grau, sofern kein höheres Signal bekannt ist.</p><p><b>Grün bedeutet ausschliesslich: kein erhöhtes Wetter-/Zuflusssignal in den verfügbaren Daten.</b> Keine automatische Erlaubnis für Arbeiten oder Einstieg. Quelle Bern/Zollikofen höchstens 40 Minuten alt, Aare höchstens 60 Minuten; Abruf höchstens 15 Minuten.</p>':'<p>Eigene zusätzliche Modellsichtung für den Punkt: Böen ab 70 km/h Gelb, ab 90 Orange, ab 110 Rot, ab 135 Violett. In Berglagen können amtliche Warnschwellen abweichen. Ein Gewitter- oder Hagelsignal erhält mindestens Orange. Flüssiger Regen in 12 Stunden: ab 20 mm Gelb, 35 Orange, 60 Rot, 100 Violett. Das sind keine automatisch ausgegebenen amtlichen Warnungen.</p><p>Für die Gesamtfarbe gilt die höchste bekannte Stufe aus Modellsichtung und amtlicher Warnung. Fehlende Daten sind Grau, keine Entwarnung. Hagelkorngrösse, Blitznähe und lokale Eintrittswahrscheinlichkeit werden nicht aus Wettercodes geschätzt.</p>';}
function render(payload){
 const kind=area,place=kind==='drainage'?{name:'Stadt Bern',lat:'46.948',lon:'7.447'}:selectedPlace(),result=assess(payload,kind);
 updateHeader(payload);
 const states=new Map(Array.from(root.querySelectorAll('details[data-env-disclosure]')).map(el=>[el.dataset.envDisclosure,el.open]));
 let html='';
 html+=panel('risk',kind==='drainage'?'Risiko-Ampel · Arbeiten im Kanalnetz':'Unwetter-Ampel','🚦',riskPanel(result,kind,payload),false,true,result.level);
 html+=panel('warnings','Amtliche MeteoSchweiz-Warnungen','⚠️',warningPanel(payload),false,true,payload?.warnings&&payloadCurrent(payload,10*60000)?(activeWarnings(payload).length?'warning':'clear'):'unavailable');
 if(kind==='drainage')html+=panel('observations','Niederschlag · gemessen','🌧️',rainMeasurements(payload||{}),true)+panel('catchment','Niederschlag im Stadtgebiet und Aare-Kontext','🗺️',pointTable(payload||{}),true)+panel('gauges','Aarepegel und Abfluss · Bund','🌊','<div class="env-reference-grid">'+gaugeCard(payload?.aare_bern,'2135')+gaugeCard(payload?.aare_thun,'2030')+'</div><p class="station-note">Aktuelle Flussmessungen, keine Kanalnetz-Sensoren. Die Aarelage allein kann lokale Rückstau-, Pumpen- oder Beckenrisiken nicht beurteilen.</p>',true);
 else html+=panel('hazards','Sturm, Hagel und Unwetter auf einen Blick','⛈️',hazardCards(payload||{}),true);
 html+=radar(kind,place)+panel('hourly','Lage in den nächsten 24 Stunden · '+(kind==='drainage'?'Entwässerung':'Naturgefahren'),'🕒',outlook24(payload||{},kind),true)+panel('data-guide','Messwerte und Prognosen verstehen','ℹ️',measurementGuide(kind),true,false)+panel('sources','Quellen / Datenbasis','📚',sources(kind,payload),true,false);
 // Radar iframes survive data refreshes, keeping their map and time selections.
 const frames=Array.from(root.querySelectorAll('iframe'));root.innerHTML=html;
 const newFrames=Array.from(root.querySelectorAll('iframe'));if(lastKey===kind+'/'+place.name)frames.forEach((frame,i)=>newFrames[i]?.replaceWith(frame));lastKey=kind+'/'+place.name;
 for(const details of root.querySelectorAll('details[data-env-disclosure]'))if(states.has(details.dataset.envDisclosure))details.open=states.get(details.dataset.envDisclosure);
}
// The same documented CORS fallback as the winter view, with a bounded browser cache.
const forecastMemory=new Map();
const forecastPoints={bern:{id:'bern',name:'Bern · Stadtmitte',lat:46.948,lon:7.447,scope:'Stadtgebiet'},west:{id:'west',name:'Bern · Westen',lat:46.945,lon:7.377,scope:'Stadtgebiet'},ost:{id:'ost',name:'Bern · Osten',lat:46.95,lon:7.50,scope:'Stadtgebiet'},belp:{id:'belp',name:'Belp · Aare-Zulaufgebiet',lat:46.89,lon:7.50,scope:'Regionaler Kontext'},thun:{id:'thun',name:'Thun · Aare oberhalb Bern',lat:46.758,lon:7.63,scope:'Regionaler Kontext'},meikirch:{id:'meikirch',name:'Meikirch',lat:47.008804,lon:7.363820},blatten:{id:'blatten',name:'Blatten bei Naters',lat:46.359364,lon:7.983037}};
async function browserForecast(kind,place,signal){
 const key=kind==='drainage'?'bern-region':place,old=forecastMemory.get(key);
 if(old&&Date.now()-old.at<30*60000){if(old.error)throw Error(old.error);return old.value;}
 const points=kind==='drainage'?['bern','west','ost','belp','thun'].map(id=>forecastPoints[id]):[forecastPoints[place]];
 const url=new URL('https://api.open-meteo.com/v1/forecast');url.search=new URLSearchParams({latitude:points.map(p=>p.lat).join(','),longitude:points.map(p=>p.lon).join(','),timezone:'UTC',forecast_days:'3',hourly:'precipitation,rain,showers,snowfall,weather_code,wind_gusts_10m,wind_speed_10m',models:'meteoswiss_icon_seamless'});
 try{
  const {response,data:raw}=await requestJSON(url.href,{cache:'no-store',credentials:'omit'},18000,signal);
  if(!response.ok)throw Error(response.status===429?'Auch der direkte Wetterabruf hat sein Abruflimit erreicht (HTTP 429).':'Direkter Wetterabruf vorübergehend nicht verfügbar.');
  const list=Array.isArray(raw)?raw:[raw];if(list.length!==points.length)throw Error('Räumliche Prognose unvollständig.');
  const mapped=list.map((v,i)=>{if(!Array.isArray(v.hourly?.time)||v.hourly_units?.precipitation!=='mm'||v.hourly_units?.wind_gusts_10m!=='km/h')throw Error('Prognoseeinheiten fehlen.');
   const n=(key,j)=>typeof v.hourly[key]?.[j]==='number'&&Number.isFinite(v.hourly[key][j])?v.hourly[key][j]:null;
   const rows=v.hourly.time.map((t,j)=>({time:t.endsWith('Z')?t:t+'Z',precip_mm:n('precipitation',j),rain_mm:n('rain',j)!==null&&n('showers',j)!==null?n('rain',j)+n('showers',j):null,snow_cm:n('snowfall',j),gust_kmh:n('wind_gusts_10m',j),wind_kmh:n('wind_speed_10m',j),code:n('weather_code',j)})).filter(r=>Date.parse(r.time)>Math.floor(Date.now()/3600000)*3600000&&Date.parse(r.time)<Date.now()+48*3600000);
   if(!rows.length)throw Error('Keine aktuelle Prognose.');return {...points[i],hours:rows};});
  const value={model:'MeteoSchweiz ICON CH1/CH2 über Open-Meteo · direkter Browserabruf',points:mapped,fetched_at:Date.now()};forecastMemory.set(key,{at:Date.now(),value});return value;
 }catch(error){if(!signal?.aborted)forecastMemory.set(key,{at:Date.now(),error:error.message});throw error;}
}
async function load(force=false){
 if(area==='winter')return;const key=area,place=area==='drainage'?'bern':selectedPlace().id,run=++sequence;controller?.abort();controller=new AbortController();loading=true;loadError='';render(data?.area===key&&data.location===place?data:null);
 try{const {response,data:next}=await requestJSON('/api/environment?area='+key+'&location='+place+(force?'&refresh=1':''),{cache:'no-store'},30000,controller.signal);if(!response.ok||next?.area!==key||next.location!==place)throw Error('Bereichsdaten nicht verfügbar');if(!next.forecast){try{next.forecast=await browserForecast(key,place,controller.signal);next.errors=(next.errors||[]).filter(k=>k!=='forecast');}catch(error){next.source_errors={...next.source_errors,forecast:error.message};}}if(run!==sequence||area!==key)return;data=next;}
 catch(error){if(run!==sequence||controller.signal.aborted)return;loadError='Bereichsdaten konnten nicht geladen werden. Bitte erneut versuchen.';data=null;}
 finally{if(run===sequence){loading=false;if(area!=='winter')render(data);}}
}
function apply(){
 document.body.dataset.discipline=area;const winter=area==='winter';$d('#dashboardGrid').hidden=!winter;root.hidden=winter;$d('#weatherLocationField').hidden=area==='drainage';$d('#drainageLocation').hidden=area!=='drainage';$d('#disciplineSelect').value=area;
 $d('#locationSubtitle').textContent=meta[area].subtitle;$d('#heroTagline').textContent=meta[area].tagline;
 if(winter){sequence++;controller?.abort();data=null;if(typeof refreshDashboard==='function')refreshDashboard();return;}if(typeof pauseWinterRefresh==='function')pauseWinterRefresh();load();
}
$d('#disciplineSelect').addEventListener('change',()=>{area=$d('#disciplineSelect').value;try{localStorage.setItem('meteo-discipline',area);}catch{}data=null;lastKey='';root.innerHTML='';apply();});
$d('#locationSelect').addEventListener('change',()=>{if(area!=='winter'){data=null;lastKey='';root.innerHTML='';apply();}});
// Only re-evaluate age on return; data retrieval is manual after the initial load.
function checkDisplayedAge(){if(area!=='winter'&&data)render(data);}
window.addEventListener('pageshow',checkDisplayedAge);document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkDisplayedAge();});
setInterval(()=>{if(!document.hidden)checkDisplayedAge();},60000);
// Expose pure evaluation helpers to meaningful regression tests, not user controls.
window.meteoDisciplines={browserForecast,assess,summary,gaugeLevel,sourceFresh:freshness,regionMetrics,planningBlock,lowRainPhase};apply();
})();
