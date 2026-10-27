const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID,randomBytes,scryptSync,timingSafeEqual} = require('node:crypto');
const store = require('./storage');

const ROOT=__dirname, DATA_DIR=process.env.DATA_DIR||path.join(__dirname,'data'), PORT=Number(process.env.PORT)||3000;
const categories=['Street food','Coffee & drinks','Fresh & flowers','Bakes & sweets','Makers'];
const seedVendors=[
 {id:'maya-taco-cart',name:'Maya’s Little Taco Cart',category:'Street food',type:'art-food',emoji:'🌮',desc:'Hand-pressed tortillas & big Sunday energy.',rating:'4.9',reviews:128,distance:'0.2 mi away',place:'Maple Street Market',hours:'Today, 11:30 am – 7:00 pm',note:'Maya makes her tortillas fresh every morning. Ask for the salsa verde — it goes fast.'},
 {id:'good-morning-sun',name:'Good Morning, Sun',category:'Coffee & drinks',type:'art-coffee',emoji:'🥤',desc:'Very good coffee, even better conversations.',rating:'4.8',reviews:96,distance:'0.4 mi away',place:'Riverside Walk',hours:'Today, 7:00 am – 2:00 pm',note:'Serving small-batch coffee and house-made chai. Bring your own cup for a little discount.'},
 {id:'petal-pusher',name:'Petal Pusher',category:'Fresh & flowers',type:'art-flower',emoji:'💐',desc:'Loose, lovely bunches, tied up with care.',rating:'5.0',reviews:74,distance:'0.6 mi away',place:'Old Town Square',hours:'Today, 9:00 am – 5:30 pm',note:'Seasonal stems sourced from nearby growers. Same-day little bouquets are always on the cart.'},
 {id:'crumb-and-co',name:'Crumb & Co.',category:'Bakes & sweets',type:'art-bread',emoji:'🥐',desc:'Tiny batches. Flaky layers. Zero leftovers.',rating:'4.9',reviews:203,distance:'0.7 mi away',place:'Pine Corner',hours:'Today, 8:00 am – 1:00 pm',note:'Everything is baked before sunrise. The cardamom buns usually sell out first.'},
 {id:'the-good-pick',name:'The Good Pick',category:'Street food',type:'art-fruit',emoji:'🍓',desc:'Fruit cups that taste like a proper summer.',rating:'4.7',reviews:62,distance:'0.9 mi away',place:'Greenway Entrance',hours:'Today, 10:00 am – 6:00 pm',note:'Cut to order with fruit from the morning market. Add a squeeze of lime and a pinch of chilli.'},
 {id:'made-by-june',name:'Made by June',category:'Makers',type:'art-craft',emoji:'🧶',desc:'Little handmade things to make home feel yours.',rating:'5.0',reviews:41,distance:'1.1 mi away',place:'Maple Street Market',hours:'Today, 10:00 am – 4:00 pm',note:'Small-batch ceramics and woven pieces. June can make a custom colour just for you.'}
];
function send(res,status,data,headers={}){const secure=process.env.NODE_ENV==='production'?{'Strict-Transport-Security':'max-age=31536000; includeSubDomains'}:{};res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'strict-origin-when-cross-origin',...secure,...headers});res.end(JSON.stringify(data));}
function cookie(res,value,age=60*60*24*7){res.setHeader('Set-Cookie',`nd_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${process.env.NODE_ENV==='production'?'; Secure':''}`);}
async function sessionFor(req){const raw=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('nd_session='));const key=raw?.slice('nd_session='.length);if(!key)return null;const s=await store.session(key);return s?{key,...s}:null;}
function hashPassword(password,salt=randomBytes(16).toString('hex')){return {salt,hash:scryptSync(password,salt,64).toString('hex')};}
function passwordMatches(password,record){try{return timingSafeEqual(Buffer.from(hashPassword(password,record.salt).hash,'hex'),Buffer.from(record.hash,'hex'));}catch{return false;}}
async function createSession(res,user){const key=randomBytes(32).toString('hex'),expiresAt=new Date(Date.now()+7*86400000).toISOString();await store.createSession(key,user.role,user.userId,expiresAt);cookie(res,key);}
function clean(value,max){return typeof value==='string'?value.trim().slice(0,max):'';}
function readBody(req){return new Promise((resolve,reject)=>{let body='';req.on('data',chunk=>{body+=chunk;if(body.length>16384){reject(new Error('Request is too large'));req.destroy();}});req.on('end',()=>{try{resolve(JSON.parse(body||'{}'));}catch{reject(new Error('Send valid JSON'));}});req.on('error',reject);});}
async function requireRole(req,res,role){const session=await sessionFor(req);if(!session||session.role!==role){send(res,401,{error:'Please sign in to continue.'});return null;}return session;}
const authAttempts=new Map();
function rateLimited(req,key,limit=12){const ip=req.socket.remoteAddress||'unknown',id=`${ip}:${key}`,now=Date.now(),record=authAttempts.get(id)||{count:0,reset:now+900000};if(record.reset<=now){record.count=0;record.reset=now+900000;}record.count++;authAttempts.set(id,record);if(authAttempts.size>5000)for(const [k,v] of authAttempts)if(v.reset<=now)authAttempts.delete(k);return record.count>limit;}
function error(res,e){const known=e.message==='Send valid JSON'||e.message==='Request is too large';if(!known)console.error('Request failed:',e.message);send(res,e.message==='Send valid JSON'?400:e.message==='Request is too large'?413:500,{error:known?e.message:'Something went wrong. Please try again.'});}
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,`http://${req.headers.host||'localhost'}`),p=url.pathname;
 try{
  if(req.method==='GET'&&p==='/api/health')return send(res,200,{ok:true});
  if(req.method==='GET'&&p==='/api/vendors'){
   const q=(url.searchParams.get('q')||'').trim().toLowerCase(),category=url.searchParams.get('category');
   return send(res,200,{vendors:(await store.vendors()).filter(v=>(!category||category==='All'||v.category===category)&&(!q||[v.name,v.category,v.desc,v.place].join(' ').toLowerCase().includes(q)))});
  }
  if(req.method==='GET'&&p==='/api/admin/setup-status')return send(res,200,{configured:!!(await store.admin()).hash});
  if(req.method==='POST'&&p==='/api/admin/setup'){
   const remote=req.socket.remoteAddress||'';if(remote!=='127.0.0.1'&&remote!=='::1'&&remote!=='::ffff:127.0.0.1')return send(res,403,{error:'Admin setup is only available from this computer.'});
   if((await store.admin()).hash)return send(res,409,{error:'Admin password is already set.'});
   const b=await readBody(req),password=clean(b.password,200);if(password.length<12)return send(res,400,{error:'Choose a password with at least 12 characters.'});
   await store.saveAdmin({...hashPassword(password),createdAt:new Date().toISOString()});await createSession(res,{role:'admin'});return send(res,201,{message:'Admin account created.'});
  }
  if(req.method==='POST'&&p==='/api/admin/login'){
   if(rateLimited(req,'admin-login',8))return send(res,429,{error:'Too many attempts. Please wait 15 minutes and try again.'});
   const b=await readBody(req),account=await store.admin();if(!account.hash||!passwordMatches(String(b.password||''),account))return send(res,401,{error:'Incorrect admin password.'});
   await createSession(res,{role:'admin'});return send(res,200,{message:'Signed in.'});
  }
  if(req.method==='POST'&&p==='/api/vendor/register'){
   if(rateLimited(req,'vendor-register',8))return send(res,429,{error:'Too many attempts. Please wait 15 minutes and try again.'});
   const b=await readBody(req),name=clean(b.name,80),category=clean(b.category,40),place=clean(b.place,120),email=clean(b.email,254).toLowerCase(),password=String(b.password||'');
   if(name.length<2||!categories.includes(category)||place.length<2||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<10||password.length>200)return send(res,400,{error:'Enter a stall name, category, location, valid email and password (10+ characters).'});
   if(await store.userByEmail(email))return send(res,409,{error:'An account already exists for that email. Please sign in.'});
   const user={id:randomUUID(),email,...hashPassword(password),createdAt:new Date().toISOString()};
   const application={id:randomUUID(),userId:user.id,name,category,place,email,status:'pending',createdAt:new Date().toISOString()};await store.addVendorRegistration(user,application);
   await createSession(res,{role:'vendor',userId:user.id});return send(res,201,{message:'Account created. Your application is waiting for review.',application:{name,category,status:'pending'}});
  }
  if(req.method==='POST'&&p==='/api/vendor/login'){
   if(rateLimited(req,'vendor-login'))return send(res,429,{error:'Too many attempts. Please wait 15 minutes and try again.'});
   const b=await readBody(req),email=clean(b.email,254).toLowerCase(),user=await store.userByEmail(email);if(!user||!passwordMatches(String(b.password||''),user))return send(res,401,{error:'Email or password is incorrect.'});
   await createSession(res,{role:'vendor',userId:user.id});return send(res,200,{message:'Signed in.'});
  }
  if(req.method==='GET'&&p==='/api/vendor/me'){
   const session=await requireRole(req,res,'vendor');if(!session)return;const app=await store.applicationByUser(session.userId);return send(res,200,{application:app?{name:app.name,category:app.category,place:app.place,status:app.status}:null});
  }
  if(req.method==='GET'&&p==='/api/admin/me'){if(!await requireRole(req,res,'admin'))return;return send(res,200,{role:'admin'});}
  if(req.method==='GET'&&p==='/api/admin/applications'){
   if(!await requireRole(req,res,'admin'))return;return send(res,200,{applications:(await store.applications()).map(({id,name,category,place,email,status,createdAt})=>({id,name,category,place,email,status,createdAt}))});
  }
  const decision=p.match(/^\/api\/admin\/applications\/([\w-]+)\/decision$/);
  if(req.method==='POST'&&decision){
   if(!await requireRole(req,res,'admin'))return;const b=await readBody(req),status=b.status;if(!['approved','rejected'].includes(status))return send(res,400,{error:'Choose approve or reject.'});
   const app=await store.decideApplication(decision[1],status,new Date().toISOString());if(!app)return send(res,404,{error:'Application not found.'});
   if(status==='approved'){
    await store.addVendor({id:`vendor-${app.id}`,applicationId:app.id,name:app.name,category:app.category,type:({'Street food':'art-food','Coffee & drinks':'art-coffee','Fresh & flowers':'art-flower','Bakes & sweets':'art-bread','Makers':'art-craft'})[app.category],emoji:({'Street food':'🌮','Coffee & drinks':'☕','Fresh & flowers':'💐','Bakes & sweets':'🥐','Makers':'🧶'})[app.category],desc:`Local favourite serving ${app.category.toLowerCase()}.`,rating:'New',reviews:0,distance:'Nearby',place:app.place,hours:'Check with the vendor',note:`Find ${app.name} at ${app.place}.`});
   }
   return send(res,200,{message:`Application ${status}.`});
  }
  if(req.method==='POST'&&p==='/api/logout'){const s=await sessionFor(req);if(s)await store.deleteSession(s.key);cookie(res,'',0);return send(res,200,{message:'Signed out.'});}
  if(p.startsWith('/api/'))return send(res,404,{error:'API route not found'});
  const requested=p==='/'?'/index.html':decodeURIComponent(p),file=path.resolve(ROOT,`.${requested}`);
  if((!file.startsWith(ROOT+path.sep)&&file!==path.join(ROOT,'index.html'))||file===DATA_DIR||file.startsWith(DATA_DIR+path.sep))return send(res,404,{error:'Not found'});
  fs.readFile(file,(e,data)=>{if(e){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});return res.end('Not found');}const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon'};res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});res.end(data);});
 }catch(e){if(!res.headersSent)error(res,e);else res.destroy();}
});
store.init(seedVendors).then(async()=>{
 if(process.env.ADMIN_PASSWORD){const current=await store.admin();if(!current.hash){const password=String(process.env.ADMIN_PASSWORD);if(password.length<12)throw new Error('ADMIN_PASSWORD must contain at least 12 characters.');await store.saveAdmin({...hashPassword(password),createdAt:new Date().toISOString()});}}
 server.listen(PORT,()=>console.log(`Near & Dear is running on port ${PORT}`));
}).catch(e=>{console.error('Startup failed:',e.message);process.exit(1);});
