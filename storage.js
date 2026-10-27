const fs=require('node:fs');
const path=require('node:path');

const dataDir=process.env.DATA_DIR||path.join(__dirname,'data');
const files={vendors:path.join(dataDir,'vendors.json'),applications:path.join(dataDir,'applications.json'),users:path.join(dataDir,'users.json'),admin:path.join(dataDir,'admin.json'),sessions:path.join(dataDir,'sessions.json')};
let pool=null;
function localRead(key){return JSON.parse(fs.readFileSync(files[key],'utf8'));}
function localWrite(key,value){fs.writeFileSync(files[key],JSON.stringify(value,null,2));}
async function init(seedVendors){
 if(process.env.DATABASE_URL){
  const {Pool}=require('pg');pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.PGSSLMODE==='require'?{rejectUnauthorized:false}:undefined,max:10,connectionTimeoutMillis:10000});
  await pool.query(`CREATE TABLE IF NOT EXISTS vendors(id TEXT PRIMARY KEY, data JSONB NOT NULL);
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS applications(id TEXT PRIMARY KEY,user_id TEXT UNIQUE NOT NULL,name TEXT NOT NULL,category TEXT NOT NULL,place TEXT NOT NULL,email TEXT NOT NULL,status TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),reviewed_at TIMESTAMPTZ);
    CREATE TABLE IF NOT EXISTS admin_settings(id INTEGER PRIMARY KEY CHECK(id=1),salt TEXT NOT NULL,password_hash TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,role TEXT NOT NULL,user_id TEXT,expires_at TIMESTAMPTZ NOT NULL);`);
  const count=await pool.query('SELECT count(*)::int AS n FROM vendors');if(!count.rows[0].n)for(const v of seedVendors)await pool.query('INSERT INTO vendors(id,data) VALUES($1,$2::jsonb) ON CONFLICT DO NOTHING',[v.id,JSON.stringify(v)]);
 }else{
  fs.mkdirSync(dataDir,{recursive:true});for(const key of Object.keys(files))if(!fs.existsSync(files[key]))localWrite(key,key==='vendors'?seedVendors:[]);
 }
}
async function vendors(){return pool?(await pool.query('SELECT data FROM vendors ORDER BY id')).rows.map(r=>r.data):localRead('vendors');}
async function addVendor(v){if(pool)await pool.query('INSERT INTO vendors(id,data) VALUES($1,$2::jsonb) ON CONFLICT(id) DO NOTHING',[v.id,JSON.stringify(v)]);else{const a=localRead('vendors');if(!a.some(x=>x.id===v.id)){a.push(v);localWrite('vendors',a);}}}
async function applications(){return pool?(await pool.query('SELECT id,user_id AS "userId",name,category,place,email,status,created_at AS "createdAt",reviewed_at AS "reviewedAt" FROM applications ORDER BY created_at DESC')).rows:localRead('applications');}
async function applicationById(id){return (await applications()).find(x=>x.id===id)||null;}
async function applicationByUser(userId){return (await applications()).find(x=>x.userId===userId)||null;}
async function addApplication(a){if(pool)await pool.query('INSERT INTO applications(id,user_id,name,category,place,email,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[a.id,a.userId,a.name,a.category,a.place,a.email,a.status,a.createdAt]);else{const all=localRead('applications');all.push(a);localWrite('applications',all);}}
async function decideApplication(id,status,reviewedAt){if(pool){const r=await pool.query('UPDATE applications SET status=$2,reviewed_at=$3 WHERE id=$1 RETURNING id,user_id AS "userId",name,category,place,email,status,created_at AS "createdAt",reviewed_at AS "reviewedAt"',[id,status,reviewedAt]);return r.rows[0]||null;}const all=localRead('applications'),a=all.find(x=>x.id===id);if(!a)return null;a.status=status;a.reviewedAt=reviewedAt;localWrite('applications',all);return a;}
async function userByEmail(email){if(pool){const r=await pool.query('SELECT id,email,salt, password_hash AS hash,created_at AS "createdAt" FROM users WHERE email=$1',[email]);return r.rows[0]||null;}return localRead('users').find(x=>x.email===email)||null;}
async function addUser(u){if(pool)await pool.query('INSERT INTO users(id,email,salt,password_hash,created_at) VALUES($1,$2,$3,$4,$5)',[u.id,u.email,u.salt,u.hash,u.createdAt]);else{const users=localRead('users');users.push(u);localWrite('users',users);}}
async function addVendorRegistration(u,a){if(pool){const client=await pool.connect();try{await client.query('BEGIN');await client.query('INSERT INTO users(id,email,salt,password_hash,created_at) VALUES($1,$2,$3,$4,$5)',[u.id,u.email,u.salt,u.hash,u.createdAt]);await client.query('INSERT INTO applications(id,user_id,name,category,place,email,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[a.id,a.userId,a.name,a.category,a.place,a.email,a.status,a.createdAt]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}else{const users=localRead('users'),apps=localRead('applications');users.push(u);apps.push(a);localWrite('users',users);localWrite('applications',apps);}}
async function admin(){if(pool){const r=await pool.query('SELECT salt,password_hash AS hash,created_at AS "createdAt" FROM admin_settings WHERE id=1');return r.rows[0]||{};}return localRead('admin');}
async function saveAdmin(a){if(pool)await pool.query('INSERT INTO admin_settings(id,salt,password_hash,created_at) VALUES(1,$1,$2,$3)',[a.salt,a.hash,a.createdAt]);else localWrite('admin',a);}
async function createSession(id,role,userId,expiresAt){if(pool)await pool.query('INSERT INTO sessions(id,role,user_id,expires_at) VALUES($1,$2,$3,$4)',[id,role,userId||null,expiresAt]);else{const all=localRead('sessions').filter(s=>new Date(s.expiresAt)>new Date());all.push({id,role,userId,expiresAt});localWrite('sessions',all);}}
async function session(id){if(pool){const r=await pool.query('SELECT id,role,user_id AS "userId",expires_at AS "expiresAt" FROM sessions WHERE id=$1 AND expires_at>now()',[id]);return r.rows[0]||null;}return localRead('sessions').find(s=>s.id===id&&new Date(s.expiresAt)>new Date())||null;}
async function deleteSession(id){if(pool)await pool.query('DELETE FROM sessions WHERE id=$1',[id]);else localWrite('sessions',localRead('sessions').filter(s=>s.id!==id));}
module.exports={init,vendors,addVendor,applications,applicationById,applicationByUser,addApplication,decideApplication,userByEmail,addUser,addVendorRegistration,admin,saveAdmin,createSession,session,deleteSession};
