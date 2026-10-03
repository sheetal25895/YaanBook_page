require('dotenv').config();
const express=require('express'),nodemailer=require('nodemailer'),multer=require('multer'),crypto=require('crypto'),fs=require('fs'),path=require('path');
const env=process.env,DATA=path.join(__dirname,'data'),UP=path.join(__dirname,'public/uploads');
fs.mkdirSync(DATA,{recursive:true});fs.mkdirSync(UP,{recursive:true});
const rd=(f,d)=>{try{return JSON.parse(fs.readFileSync(path.join(DATA,f)))}catch{return d}};
const wr=(f,v)=>fs.writeFileSync(path.join(DATA,f),JSON.stringify(v,null,2));
const SEED=[[1,'Gulfstream G650ER',850000,'Mumbai'],[2,'Bombardier Global 6000',720000,'Delhi'],[3,'Dassault Falcon 2000',480000,'Bengaluru'],[4,'Embraer Phenom 300',260000,'Hyderabad'],[5,'Citation XLS+',290000,'Jaipur'],[6,'AgustaWestland AW139',240000,'Delhi'],[7,'Airbus H145',160000,'Mumbai'],[8,'Bell 407',110000,'Bengaluru']].map(([id,name,rate,at])=>({id,name,rate,at,to:null,p:0,photo:null,icao24:null}));
if(!fs.existsSync(path.join(DATA,'fleet.json')))wr('fleet.json',SEED);

const app=express();app.use(express.json({limit:'50kb'}));app.use(express.static(path.join(__dirname,'public')));
const SECRET=env.SESSION_SECRET||crypto.randomBytes(32).toString('hex');
const ops=Object.fromEntries((env.OPERATORS||'').split(',').filter(Boolean).map(s=>{const i=s.indexOf(':');return [s.slice(0,i).trim(),s.slice(i+1)]}));
const sign=s=>crypto.createHmac('sha256',SECRET).update(s).digest('hex');
const same=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y)};
const auth=(req,res,next)=>{const t=(req.get('authorization')||'').replace('Bearer ','');const[b,sig]=t.split('.');
  try{const p=JSON.parse(Buffer.from(b,'base64url'));if(sig&&same(sign(b),sig)&&p.exp>Date.now())return next()}catch{}
  res.status(401).json({error:'Please sign in'})};
const hits=new Map();const limited=ip=>{const n=(hits.get(ip)||[]).filter(t=>Date.now()-t<60000);n.push(Date.now());hits.set(ip,n);return n.length>5};
const clean=(v,n=300)=>String(v??'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,n);

async function sendEmail(e,text,subj){
  if(!env.SMTP_USER||!env.SMTP_PASS)return'not configured';
  try{await nodemailer.createTransport({service:'gmail',auth:{user:env.SMTP_USER,pass:env.SMTP_PASS}})
    .sendMail({from:`YaanBook <${env.SMTP_USER}>`,to:env.NOTIFY_EMAIL||env.SMTP_USER,subject:subj||`New ${e.vip!=='Standard'?'VIP ':''}booking request ${e.ref}: ${e.aircraft}`,text});return'sent'}
  catch(x){return'failed: '+x.message}}
async function sendWhatsApp(text){
  if(!env.TWILIO_SID||!env.TWILIO_TOKEN)return'not configured';
  try{const r=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_SID}/Messages.json`,{method:'POST',
    headers:{Authorization:'Basic '+Buffer.from(env.TWILIO_SID+':'+env.TWILIO_TOKEN).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({From:env.TWILIO_WA_FROM||'whatsapp:+14155238886',To:env.NOTIFY_WHATSAPP||'whatsapp:+917406791221',Body:text})});
    return r.ok?'sent':'failed: '+(await r.text()).slice(0,200)}catch(x){return'failed: '+x.message}}

app.get('/api/health',(q,r)=>r.json({ok:true,email:!!(env.SMTP_USER&&env.SMTP_PASS),whatsapp:!!(env.TWILIO_SID&&env.TWILIO_TOKEN),operators:Object.keys(ops).length}));
const live={};
// Live positions from adsb.lol (free, no key, ODbL). Tracks by DGCA registration mark (VT-XXX) or ICAO24 hex.
async function adsb(a){const r=await fetch('https://api.adsb.lol/v2/'+(a.reg?'reg/'+a.reg:'hex/'+a.icao24),{headers:{'User-Agent':'YaanBook/1.0'}});
  if(!r.ok)throw new Error('status '+r.status);const j=await r.json(),v=(j.ac||[]).find(x=>x.lat!=null&&x.lon!=null);if(!v)return null;
  const gnd=v.alt_baro==='ground';
  return{lat:v.lat,lon:v.lon,hdg:v.track??v.true_heading??0,alt:gnd?0:(v.alt_baro??v.alt_geom??0)/3.281,spd:(v.gs||0)/1.944,gnd,ts:(j.now||Date.now())-(v.seen_pos??v.seen??0)*1000}}
async function poll(){for(const a of rd('fleet.json',SEED)){
  if(!a.reg&&!/^[0-9a-f]{6}$/i.test(a.icao24||'')){delete live[a.id];continue}
  try{const v=await adsb(a);if(v)live[a.id]=v;else delete live[a.id]}catch(x){console.log('Live position error for',a.name,x.message)}}}
setInterval(poll,120000);poll();
app.get('/api/fleet',(q,r)=>r.json(rd('fleet.json',SEED).map(({icao24,reg,...a})=>({...a,live:live[a.id]||null}))));
app.get('/api/operators',(q,r)=>{const d=rd('operators.json',null);if(!d)return r.json({operators:[]});
  r.json({...d,operators:d.operators.map(({aircraft,...o})=>({...o,aircraft:aircraft.map(({reg,...a})=>a)}))})});
app.get('/api/operator/fleet',auth,(q,r)=>r.json(rd('fleet.json',SEED).map(a=>({...a,live:live[a.id]||null}))));
app.get('/api/status/:ref',(req,res)=>{if(limited(req.ip))return res.status(429).json({error:'Too many requests'});
  const e=rd('enquiries.json',[]).find(x=>x.ref===req.params.ref),d=x=>String(x||'').replace(/\D/g,'').slice(-10);
  if(!e||d(e.phone)!==d(req.query.phone)||d(req.query.phone).length<10)return res.status(404).json({error:'No request found for that reference and phone number.'});
  res.json({status:e.status||'pending',reason:e.reason||''})});
app.put('/api/operator/enquiries/:ref',auth,async(req,res)=>{const all=rd('enquiries.json',[]),e=all.find(x=>x.ref===req.params.ref),b=req.body||{};
  if(!e||!['confirmed','declined'].includes(b.status))return res.status(400).json({error:'Unknown request or status'});
  e.status=b.status;e.reason=clean(b.reason,200);e.decidedAt=new Date().toISOString();wr('enquiries.json',all);
  const t=`Request ${e.ref} (${e.aircraft}, ${e.name}) was ${e.status}${e.reason?': '+e.reason:''}.`;
  const[email,whatsapp]=await Promise.all([sendEmail(e,t,`Booking ${e.ref} ${e.status}`),sendWhatsApp(t)]);res.json({ok:true,notified:{email,whatsapp}})});

app.post('/api/enquiries',async(req,res)=>{
  if(limited(req.ip))return res.status(429).json({error:'Too many requests. Try again in a minute.'});
  const b=req.body||{};
  const e={ref:'YB-'+Date.now().toString(36).toUpperCase(),at:new Date().toISOString(),status:'pending',aircraft:clean(b.aircraft),from:clean(b.from,60),to:clean(b.to,60),
    hours:Number(b.hours)||0,estimate:clean(b.estimate,40),name:clean(b.name,80),phone:clean(b.phone,25),date:clean(b.date,20),
    pax:Math.min(Math.max(parseInt(b.pax)||1,1),40),vip:clean(b.vip,60)||'Standard',notes:clean(b.notes,600)};
  if(!e.name||!e.phone||!e.aircraft)return res.status(400).json({error:'Name, phone and aircraft are required.'});
  const text=`New booking request ${e.ref}\nAircraft: ${e.aircraft}\nRoute: ${e.from} to ${e.to}, ${e.hours} hr (est. ${e.estimate})\nDate: ${e.date||'flexible'}\nPassengers: ${e.pax}\nService: ${e.vip}\nClient: ${e.name}, ${e.phone}\nNotes: ${e.notes||'none'}`;
  const [email,whatsapp]=await Promise.all([sendEmail(e,text),sendWhatsApp(text)]);
  e.notified={email,whatsapp};
  const all=rd('enquiries.json',[]);all.unshift(e);wr('enquiries.json',all);
  console.log('Enquiry',e.ref,e.notified);
  res.json({ok:true,ref:e.ref,notified:e.notified});
});

app.post('/api/login',(req,res)=>{const{user,pass}=req.body||{};
  if(user&&ops[user]!==undefined&&same(String(pass||''),ops[user])){const b=Buffer.from(JSON.stringify({u:user,exp:Date.now()+12*3600e3})).toString('base64url');return res.json({token:b+'.'+sign(b)})}
  res.status(401).json({error:'Wrong username or password'})});
app.get('/api/operator/enquiries',auth,(q,r)=>r.json(rd('enquiries.json',[])));
app.put('/api/operator/fleet/:id',auth,(req,res)=>{const f=rd('fleet.json',SEED),a=f.find(x=>x.id==req.params.id);if(!a)return res.sendStatus(404);
  const b=req.body||{};if(b.rate>0)a.rate=Math.round(b.rate);if(b.at)a.at=clean(b.at,40);a.to=b.to?clean(b.to,40):null;const t=String(b.track??b.icao24??'').trim().toUpperCase();a.reg=/^VT-[A-Z]{3}$/.test(t)?t:null;a.icao24=/^[0-9A-F]{6}$/.test(t)?t.toLowerCase():null;a.p=a.to?0.1:0;wr('fleet.json',f);res.json(a)});
const up=multer({storage:multer.diskStorage({destination:UP,filename:(q,f,cb)=>cb(null,`${q.params.id}-${Date.now()}${{'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp'}[f.mimetype]}`)}),
  limits:{fileSize:5e6},fileFilter:(q,f,cb)=>cb(null,['image/jpeg','image/png','image/webp'].includes(f.mimetype))});
app.post('/api/operator/fleet/:id/photo',auth,up.single('photo'),(req,res)=>{const f=rd('fleet.json',SEED),a=f.find(x=>x.id==req.params.id);
  if(!a||!req.file)return res.status(400).json({error:'Upload a JPG, PNG or WebP under 5 MB'});a.photo='/uploads/'+req.file.filename;wr('fleet.json',f);res.json(a)});

app.listen(env.PORT||3000,()=>console.log('YaanBook running on port '+(env.PORT||3000)));
