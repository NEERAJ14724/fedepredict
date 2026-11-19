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

