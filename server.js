import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'node:querystring';

const root = fileURLToPath(new URL('.', import.meta.url));
let port = Number(process.env.PORT || 3000);
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml' };

function parseCsvLine(line) {
  const values=[]; let value='', quoted=false;
  for (let i=0;i<line.length;i++) {
    const c=line[i];
    if (c==='"' && quoted && line[i+1]==='"') { value+='"'; i++; }
    else if (c==='"') quoted=!quoted;
    else if (c===',' && !quoted) { values.push(value); value=''; }
    else value+=c;
  }
  values.push(value); return values;
}
function loadRows(csv) {
  const lines=csv.split(/\r?\n/).filter(Boolean), keys=parseCsvLine(lines.shift());
  return lines.map(line=>{
    const values=parseCsvLine(line), row=Object.fromEntries(keys.map((key,i)=>[key,values[i]]));
    for (const key of ['year','month','arr_flights','arr_del15','arr_cancelled','arr_diverted','arr_delay','carrier_delay','weather_delay','nas_delay','security_delay','late_aircraft_delay']) row[key]=Number(row[key])||0;
    return row;
  });
}
const rows=loadRows(await readFile(resolve(root,'data/flight_delay.csv'),'utf8'));
const airports={
  ATL:{name:'Atlanta',lat:33.6407,lon:-84.4277},ORD:{name:'Chicago O’Hare',lat:41.9742,lon:-87.9073},DFW:{name:'Dallas/Fort Worth',lat:32.8998,lon:-97.0403},DEN:{name:'Denver',lat:39.8561,lon:-104.6737},CLT:{name:'Charlotte',lat:35.2144,lon:-80.9473},LAX:{name:'Los Angeles',lat:33.9416,lon:-118.4085},PHX:{name:'Phoenix',lat:33.4342,lon:-112.0116},SEA:{name:'Seattle',lat:47.4502,lon:-122.3088},LAS:{name:'Las Vegas',lat:36.084,lon:-115.1537},IAH:{name:'Houston',lat:29.9902,lon:-95.3368},MCO:{name:'Orlando',lat:28.4312,lon:-81.3081},LGA:{name:'New York LaGuardia',lat:40.7769,lon:-73.874},EWR:{name:'Newark',lat:40.6895,lon:-74.1745},DCA:{name:'Washington Reagan',lat:38.8512,lon:-77.0402},BOS:{name:'Boston',lat:42.3656,lon:-71.0096},DTW:{name:'Detroit',lat:42.2162,lon:-83.3554},SFO:{name:'San Francisco',lat:37.6213,lon:-122.379},MSP:{name:'Minneapolis',lat:44.8848,lon:-93.2223},JFK:{name:'New York JFK',lat:40.6413,lon:-73.7781},SLC:{name:'Salt Lake City',lat:40.7899,lon:-111.9791},PHL:{name:'Philadelphia',lat:39.8744,lon:-75.2424},MIA:{name:'Miami',lat:25.7959,lon:-80.287},BNA:{name:'Nashville',lat:36.1263,lon:-86.6774},BWI:{name:'Baltimore',lat:39.1774,lon:-76.6684}
};
const apiCache=new Map(); let openSkyToken=null;
async function cachedApi(key, ttlMs, loader){const cached=apiCache.get(key);if(cached&&Date.now()-cached.at<ttlMs)return cached.value;const value=await loader();apiCache.set(key,{at:Date.now(),value});return value;}
async function openSkyAuth(){if(openSkyToken&&openSkyToken.expires>Date.now())return openSkyToken.value;const id=process.env.OPENSKY_CLIENT_ID,secret=process.env.OPENSKY_CLIENT_SECRET;if(!id||!secret)return null;const form=new URLSearchParams({grant_type:'client_credentials',client_id:id,client_secret:secret});const r=await fetch('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form,signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error(`OpenSky authentication returned ${r.status}`);const data=await r.json();openSkyToken={value:data.access_token,expires:Date.now()+Math.max(60,(data.expires_in||300)-30)*1000};return openSkyToken.value;}
const model={ version:1, name:'FedPredict historical FedAvg baseline', rounds:0, clients:0,
  sample_count:0, delay_probability:weightedRate(rows), mean_delay_minutes:weightedMinutes(rows), updated_at:null };
function weightedRate(items) { const flights=items.reduce((n,r)=>n+r.arr_flights,0); return flights?items.reduce((n,r)=>n+r.arr_del15,0)/flights:0; }
function weightedMinutes(items) { const flights=items.reduce((n,r)=>n+r.arr_flights,0); return flights?items.reduce((n,r)=>n+r.arr_delay,0)/flights:0; }
function json(res,status,value) { res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}); res.end(JSON.stringify(value)); }
function normalizeName(value) { return String(value||'').trim().toLowerCase(); }
function chooseRows(airline,airport,month) {
  let selection=rows;
  const a=normalizeName(airline), p=normalizeName(airport);
  if (a) { const matches=selection.filter(r=>normalizeName(r.carrier_name).includes(a)||normalizeName(r.carrier)===a); if(matches.length) selection=matches; }
  if (p) { const matches=selection.filter(r=>normalizeName(r.airport)===p||normalizeName(r.airport_name).includes(p)); if(matches.length) selection=matches; }
  if (month) { const matches=selection.filter(r=>r.month===month); if(matches.length) selection=matches; }
  return selection;
}
function overview() {
  const totalFlights=rows.reduce((n,r)=>n+r.arr_flights,0), totalDelayed=rows.reduce((n,r)=>n+r.arr_del15,0);
  const years=[...new Set(rows.map(r=>r.year))].sort();
  const months=Array.from({length:12},(_,i)=>{const m=i+1; const items=rows.filter(r=>r.month===m); return {month:m,label:new Date(2000,m-1,1).toLocaleString('en',{month:'short'}),rate:weightedRate(items),minutes:weightedMinutes(items),flights:items.reduce((n,r)=>n+r.arr_flights,0)};});
  const airports=Object.values(rows.reduce((out,r)=>{const k=r.airport; out[k]??={code:k,name:r.airport_name,flights:0,delayed:0,delay:0}; const x=out[k]; x.flights+=r.arr_flights;x.delayed+=r.arr_del15;x.delay+=r.arr_delay;return out;},{})).sort((a,b)=>b.flights-a.flights).slice(0,8).map(x=>({...x,rate:x.flights?x.delayed/x.flights:0,minutes:x.flights?x.delay/x.flights:0}));
  const carriers=[...new Set(rows.map(r=>r.carrier_name))].sort();
  return {records:rows.length,flights:totalFlights,delayed:totalDelayed,rate:totalFlights?totalDelayed/totalFlights:0,years,months,airports,carriers,model};
}
async function body(req) { let data=''; for await (const chunk of req) { data+=chunk; if(data.length>1_000_000) throw Error('Request body is too large'); } return data; }
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(req.method==='OPTIONS') {res.writeHead(204,{'access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type'});return res.end();}
  if(req.method==='GET'&&url.pathname==='/api/health') return json(res,200,{status:'ok',records:rows.length,source:'BTS monthly airline-airport data',years:[...new Set(rows.map(r=>r.year))].sort()});
  if(req.method==='GET'&&url.pathname==='/api/live/weather') {
    const code=String(url.searchParams.get('airport')||'ATL').trim().toUpperCase(),airport=airports[code];
    if(!airport)return json(res,400,{error:`Choose one of the supported airport codes: ${Object.keys(airports).join(', ')}.`});
    try {const data=await cachedApi(`weather:${code}`,10*60*1000,async()=>{const q=new URLSearchParams({latitude:String(airport.lat),longitude:String(airport.lon),current:'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility',timezone:'auto'});const r=await fetch(`https://api.open-meteo.com/v1/forecast?${q}`,{signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error(`Weather provider returned ${r.status}`);return r.json();});return json(res,200,{airport:code,airportName:airport.name,provider:'Open-Meteo',asOf:data.current?.time,timezone:data.timezone,current:data.current,units:data.current_units,credit:'Weather data by Open-Meteo (CC BY 4.0).'});}catch(e){return json(res,502,{error:'Current weather is temporarily unavailable. Please retry shortly.'});}
  }
  if(req.method==='GET'&&url.pathname==='/api/live/aircraft') {
    const code=String(url.searchParams.get('airport')||'ATL').trim().toUpperCase(),airport=airports[code];
    if(!airport)return json(res,400,{error:`Choose one of the supported airport codes: ${Object.keys(airports).join(', ')}.`});
    try {const data=await cachedApi(`aircraft:${code}`,60*1000,async()=>{const delta=.45,q=new URLSearchParams({lamin:String(airport.lat-delta),lomin:String(airport.lon-delta),lamax:String(airport.lat+delta),lomax:String(airport.lon+delta)}),token=await openSkyAuth(),headers=token?{authorization:`Bearer ${token}`}:{},r=await fetch(`https://opensky-network.org/api/states/all?${q}`,{headers,signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error(`OpenSky returned ${r.status}`);const body=await r.json(),states=(body.states||[]).filter(s=>s[5]!=null&&s[6]!=null).slice(0,60).map(s=>({icao24:s[0],callsign:String(s[1]||'').trim(),originCountry:s[2],longitude:s[5],latitude:s[6],altitudeMeters:s[7],onGround:s[8],velocityMetersPerSecond:s[9],headingDegrees:s[10],verticalRateMetersPerSecond:s[11],lastContact:s[4]}));return {count:body.states?.length||0,aircraft:states,time:body.time};});return json(res,200,{airport:code,airportName:airport.name,provider:'OpenSky Network',asOf:new Date(data.time*1000).toISOString(),aircraftCount:data.count,aircraft:data.aircraft,notice:'Live aircraft positions only; OpenSky does not provide commercial flight schedules or delay status.'});}catch(e){const status=String(e.message).match(/returned (\d+)/)?.[1];return json(res,502,{error:status==='429'?'OpenSky rate limit reached. Wait a few minutes, then retry.':'Live aircraft data is temporarily unavailable. OpenSky may require client credentials or have rate limits.'});}
  }
  if(req.method==='GET'&&url.pathname==='/api/overview') return json(res,200,overview());
  if(req.method==='POST'&&url.pathname==='/api/predict') {
    try {
      const input=JSON.parse(await body(req)), month=Number(input.month), airline=String(input.airline||'').slice(0,120), airport=String(input.airport||'').slice(0,120);
      if(!Number.isInteger(month)||month<1||month>12) return json(res,400,{error:'Choose a valid flight month.'});
      const sample=chooseRows(airline,airport,month); let flights=sample.reduce((n,r)=>n+r.arr_flights,0);
      const rate=weightedRate(sample), minutes=weightedMinutes(sample), delayed=sample.reduce((n,r)=>n+r.arr_del15,0);
      const cancel=sample.reduce((n,r)=>n+r.arr_cancelled,0), weather=sample.reduce((n,r)=>n+r.weather_delay,0), nas=sample.reduce((n,r)=>n+r.nas_delay,0), carrier=sample.reduce((n,r)=>n+r.carrier_delay,0), late=sample.reduce((n,r)=>n+r.late_aircraft_delay,0);
      const causes=[['Carrier',carrier],['Weather',weather],['Air traffic',nas],['Late aircraft',late]].sort((a,b)=>b[1]-a[1]);
      return json(res,200,{airline:airline||'All airlines',airport:airport||'All airports',month,sampleRows:sample.length,sampleFlights:flights,delayProbability:rate,averageArrivalDelayMinutes:minutes,averageDelayWhenDelayedMinutes:delayed?sample.reduce((n,r)=>n+r.arr_delay,0)/delayed:0,cancellationRate:flights?cancel/flights:0,propagationRisk:flights?late/flights:0,causes:causes.map(([name,value])=>({name,share:(carrier+weather+nas+late)?value/(carrier+weather+nas+late):0})),method:'Historical BTS monthly aggregates; airline, airport and month matched where available.',sourceYears:[...new Set(sample.map(r=>r.year))].sort(),modelRounds:model.rounds});
    } catch { return json(res,400,{error:'Could not read the prediction request.'}); }
  }
  if(req.method==='GET'&&url.pathname==='/api/federated/model') {res.writeHead(200,{'content-type':'application/json; charset=utf-8','content-disposition':'attachment; filename="fedpredict-global-model.json"'});return res.end(JSON.stringify(model,null,2));}
  if(req.method==='POST'&&url.pathname==='/api/federated/update') {
    try {
      const u=JSON.parse(await body(req)), n=Math.floor(Number(u.sample_count)), p=Number(u.delay_probability), d=Number(u.mean_delay_minutes);
      if(!Number.isInteger(n)||n<1||n>10_000_000||!Number.isFinite(p)||p<0||p>1||!Number.isFinite(d)||d<0||d>10_000) return json(res,400,{error:'Update needs sample_count (1–10,000,000), delay_probability (0–1), and mean_delay_minutes (0–10,000).'});
      const old=model.sample_count, total=old+n;
      model.delay_probability=(model.delay_probability*old+p*n)/total; model.mean_delay_minutes=(model.mean_delay_minutes*old+d*n)/total;
      model.sample_count=total; model.rounds++; model.clients++; model.updated_at=new Date().toISOString();
      return json(res,200,{ok:true,model,notice:'Weighted Federated Averaging applied to client aggregate statistics. Raw rows were not received.'});
    } catch { return json(res,400,{error:'Update must be valid JSON.'}); }
  }
  const pathname=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname), file=resolve(root,`.${pathname}`);
  if(pathname.startsWith('/data/')) return json(res,404,{error:'Not found'});
  if(!file.startsWith(root)) return json(res,403,{error:'Forbidden'});
  try {const s=await stat(file);if(!s.isFile())throw Error();res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream'});createReadStream(file).pipe(res);} catch {res.writeHead(404);res.end('Not found');}
});
server.on('error',error=>{
  if(error.code==='EADDRINUSE'&&port===3000){port=3001;server.listen(port,'0.0.0.0');return;}
  console.error(error);process.exitCode=1;
});
server.listen(port,'0.0.0.0',()=>console.log(`FedPredict ready on http://localhost:${port} · ${rows.length.toLocaleString()} source records`));

