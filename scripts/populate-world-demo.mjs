import { grantDemoPublications } from '../packages/credits/service.mjs';
// Populate the existing local VANLY database with an explicitly fictional world.
// Existing credentials and non-demo records are never replaced.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';
import { populateWorldActivity } from './world-demo-activity.mjs';
import { buildWorldFixture, companyDetails, stockFixture, seasonFixture, person, WORLD_DEMO_VERSION, EXISTING_DEMO_COMPANY_IDS } from './world-demo-fixture.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const local = path.join(root, '.local');
dotenv.config({path:path.join(root,'.env.local'),quiet:true});
const connection = new URL(process.env.DATABASE_URL);
if (!['127.0.0.1','localhost','[::1]'].includes(connection.hostname) || connection.pathname !== '/vanly_local') throw Error('Ten import działa wyłącznie w bazie vanly_local na localhost.');
const scrypt = promisify(crypto.scrypt);
const execFileAsync = promisify(execFile);
const manifestPath = path.join(local,'world-demo-credentials.json');
const exportPath = path.join(local,'world-demo-export.json');
const fixture = buildWorldFixture();
const now = new Date('2026-10-07T10:00:00.000Z');
const args = new Set(process.argv.slice(2));
if ([...args].some(x => x !== '--export-only' && !x.startsWith('--backup-dir='))) throw Error('Obsługiwane opcje: --export-only, --backup-dir=/pełna/ścieżka/do/kopii.');
await fs.mkdir(local,{recursive:true,mode:0o700});
async function privateWrite(filename,value) {
  const temporary = filename + '.tmp-' + process.pid;
  await fs.writeFile(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600});
  await fs.chmod(temporary,0o600);
  await fs.rename(temporary,filename);
  await fs.chmod(filename,0o600);
}
async function readJson(filename,fallback=null) {
  try { return JSON.parse(await fs.readFile(filename,'utf8')); } catch(error) { if(error.code==='ENOENT') return fallback; throw error; }
}
async function verify(password,passwordHash) {
  if (!password || !passwordHash) return false;
  const [salt,expected]=passwordHash.split(':');
  if (!salt || !expected || !/^[a-f0-9]{128}$/i.test(expected)) return false;
  const actual=await scrypt(password,salt,64), target=Buffer.from(expected,'hex');
  return actual.length===target.length && crypto.timingSafeEqual(actual,target);
}
async function makeHash(password) {
  const salt=crypto.randomBytes(16).toString('hex');
  return salt+':'+(await scrypt(password,salt,64)).toString('hex');
}
async function backupBeforeChanges() {
  const provided = [...args].find(x=>x.startsWith('--backup-dir='))?.slice('--backup-dir='.length);
  if (provided) {
    const dir = path.resolve(provided);
    const metadata = await readJson(path.join(dir,'backup.json'));
    if (!metadata || metadata.database !== 'vanly_local' || !metadata.contains?.includes('database.dump')) throw Error('Podana kopia nie jest kopią vanly_local.');
    const stat = await fs.stat(path.join(dir,'database.dump'));
    if (!stat.isFile() || stat.size < 1000) throw Error('Kopia bazy jest niepełna.');
    return dir;
  }
  const result=await execFileAsync(process.execPath,[path.join(root,'scripts/backup.mjs')],{cwd:root,maxBuffer:1024*1024});
  const line=result.stdout.trim().split('\n').find(x=>x.startsWith('Kopia gotowa: '));
  if(!line) throw Error('Nie potwierdzono utworzenia kopii bazy.');
  return line.slice('Kopia gotowa: '.length);
}
const db=new pg.Client({connectionString:process.env.DATABASE_URL});
await db.connect();
let inTransaction=false;
try {
  const newCreditVehicleIds=[];
  const backupDir=args.has('--export-only')?null:await backupBeforeChanges();
  await db.query('BEGIN'); inTransaction=true;
  await db.query("SELECT pg_advisory_xact_lock(hashtext('vanly-world-demo-v1'))");
  const beforeUsers=(await db.query('SELECT * FROM users ORDER BY email')).rows;
  const beforeCompanies=(await db.query('SELECT * FROM companies ORDER BY id')).rows;
  const beforeVehicles=(await db.query('SELECT * FROM vehicles ORDER BY id')).rows;
  const beforeBookings=(await db.query('SELECT * FROM bookings ORDER BY id')).rows;
  const beforeStock=(await db.query('SELECT * FROM stock_items ORDER BY company_id,id')).rows;
  const companyIds=[...EXISTING_DEMO_COMPANY_IDS,...fixture.companies.map(c=>c.id)];
  let manifest=await readJson(manifestPath,{version:WORLD_DEMO_VERSION,fictional:true,accounts:[]});
  if(manifest.version!==WORLD_DEMO_VERSION || !Array.isArray(manifest.accounts)) throw Error('Nieoczekiwany format prywatnego manifestu kont.');
  const credentials=new Map(manifest.accounts.map(a=>[a.email,a]));
  const generatedAccounts=[...fixture.travelers.slice(100),...fixture.owners];
  const beforeByEmail=new Map(beforeUsers.map(u=>[u.email,u]));
  let activity={activityCounts:{},sampleScenarios:[]};
  let insertedUsers=0,insertedCompanies=0,insertedVehicles=0;
  if(!args.has('--export-only')) {
    for(const id of EXISTING_DEMO_COMPANY_IDS) if(!beforeCompanies.some(c=>c.id===id)) throw Error(`Brak istniejącej wypożyczalni referencyjnej ${id}.`);
    const expectedExisting=fixture.travelers.slice(0,100);
    for(const a of expectedExisting) if(beforeByEmail.get(a.email)?.role!=='traveler') throw Error(`Brak istniejącego testowego podróżnika ${a.email}.`);
    for(const a of generatedAccounts) {
      const existing=beforeByEmail.get(a.email);
      if(existing && (existing.role!==a.role || existing.company_id!==a.company_id)) throw Error(`Konflikt zakresu istniejącego konta ${a.email}.`);
      if(!existing && !credentials.has(a.email)) credentials.set(a.email,{email:a.email,password:'VanlyDemo!'+crypto.randomBytes(15).toString('base64url'),role:a.role,company_id:a.company_id,createdAt:new Date().toISOString()});
    }
    manifest={...manifest,updatedAt:new Date().toISOString(),accounts:[...credentials.values()].sort((a,b)=>a.email.localeCompare(b.email))};
    // Written before database inserts, so a failed attempt can retry identical credentials.
    await privateWrite(manifestPath,manifest);
    await privateWrite(path.join(local,'world-demo-before.json'),{createdAt:new Date().toISOString(),backupDir,companies:beforeCompanies.filter(c=>EXISTING_DEMO_COMPANY_IDS.includes(c.id)),users:beforeUsers.filter(u=>fixture.travelers.slice(0,100).some(a=>a.email===u.email)).map(({password_hash,...safe})=>safe),counts:{users:beforeUsers.length,companies:beforeCompanies.length,vehicles:beforeVehicles.length,bookings:beforeBookings.length}});
    await privateWrite(path.join(local,'world-demo-fixture.json'),fixture);
    for(const c of fixture.companies) {
      const previous=beforeCompanies.find(x=>x.id===c.id);
      if(previous && previous.settings?.demoVersion!==WORLD_DEMO_VERSION) throw Error(`Id firmy ${c.id} jest już używane poza tym demonstracyjnym importem.`);
      const result=await db.query('INSERT INTO companies(id,name,city,lat,lng,verified,settings) VALUES($1,$2,$3,$4,$5,true,$6) ON CONFLICT(id) DO NOTHING',[c.id,c.name,c.city,c.lat,c.lng,JSON.stringify(c.settings)]);
      insertedCompanies+=result.rowCount;
    }
    for(const [i,id] of EXISTING_DEMO_COMPANY_IDS.entries()) {
      const c=beforeCompanies.find(x=>x.id===id), count=beforeVehicles.filter(v=>v.company_id===id).length;
      const details=companyDetails(c,i,count);
      // Booking rules already configured by the user take precedence over generated defaults.
      const settings={...details,...c.settings,demo:true,demoVersion:WORLD_DEMO_VERSION};
      await db.query('UPDATE companies SET settings=$1 WHERE id=$2',[JSON.stringify(settings),id]);
    }
    for(const a of generatedAccounts) {
      if(beforeByEmail.has(a.email)) continue;
      const credential=credentials.get(a.email);
      if(!credential?.password) throw Error(`Brak hasła nowego konta ${a.email}.`);
      const result=await db.query('INSERT INTO users(email,name,password_hash,role,company_id,profile) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(email) DO NOTHING',[a.email,a.name,await makeHash(credential.password),a.role,a.company_id,JSON.stringify(a.profile)]);
      insertedUsers+=result.rowCount;
    }
    // Fill the existing hundred travelers without changing their identity or password.
    for(let n=1;n<=1000;n++) {
      const a=fixture.travelers[n-1];
      const existing=beforeByEmail.get(a.email);
      const row=(await db.query('SELECT id,name,profile FROM users WHERE email=$1',[a.email])).rows[0];
      // Retain the completed original profile and any later edits on repeated imports.
      if(row.profile?.demoVersion===WORLD_DEMO_VERSION) continue;
      const p=person(n,row.name).profile;
      const profile=existing?{...row.profile,...p}:row.profile;
      await db.query('UPDATE users SET profile=$1 WHERE id=$2',[JSON.stringify(profile),row.id]);
    }
    // Fill profiles of seeded owner accounts, also preserving credentials and names.
    const knownOwners=(await db.query("SELECT * FROM users WHERE role='owner' AND company_id=ANY($1::text[]) ORDER BY company_id,email",[EXISTING_DEMO_COMPANY_IDS])).rows;
    for(const [i,owner] of knownOwners.entries()) {
      const generated=person(12000+i,owner.name).profile;
      await db.query('UPDATE users SET profile=$1 WHERE id=$2',[JSON.stringify({...generated,...owner.profile,name:owner.name,phone:owner.profile.phone||generated.phone,drivers:owner.profile.drivers?.length?owner.profile.drivers:generated.drivers,demo:true,demoVersion:WORLD_DEMO_VERSION}),owner.id]);
    }

    const fields=['id','company_id','name','type','asset','city','street','house_number','lat','lng','seats','sleeps','daily','prep','deposit','min_days','auto','pets','instant','km','features','description','tagline','status'];
    for(const v of fixture.vehicles) {
      const previous=beforeVehicles.find(x=>x.id===v.id);
      if(previous && previous.company_id!==v.company_id) throw Error(`Konflikt id pojazdu ${v.id}.`);
      const result=await db.query(`INSERT INTO vehicles(${fields.join(',')}) VALUES(${fields.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT(id) DO NOTHING`,fields.map(k=>k==='features'?JSON.stringify(v[k]):v[k]));
      insertedVehicles+=result.rowCount;
      if(result.rowCount) newCreditVehicleIds.push(v.id);
    }
    const allCompanies=(await db.query('SELECT * FROM companies WHERE id=ANY($1::text[]) ORDER BY id',[companyIds])).rows;
    const allVehicles=(await db.query('SELECT * FROM vehicles WHERE company_id=ANY($1::text[]) ORDER BY company_id,id',[companyIds])).rows;
    for(const [i,c] of allCompanies.entries()) {
      const size=allVehicles.filter(v=>v.company_id===c.id).length;
      for(const e of stockFixture(c,i,size)) {
        const result=await db.query('INSERT INTO stock_items(company_id,id,name,quantity,price,unit,excluded_types,active) VALUES($1,$2,$3,$4,$5,$6,$7,true) ON CONFLICT(company_id,id) DO NOTHING',[e.company_id,e.id,e.name,e.quantity,e.price,e.unit,JSON.stringify(e.excluded_types)]);
        // Keep the user's existing item assignments; assign only newly created items.
        if(result.rowCount) await db.query(`INSERT INTO stock_item_vehicles(company_id,item_id,vehicle_id)
          SELECT $1,$2,v.id FROM vehicles v WHERE v.company_id=$1 AND NOT($3::jsonb ? v.type)
          ON CONFLICT DO NOTHING`,[e.company_id,e.id,JSON.stringify(e.excluded_types)]);
      }
    }
    for(const v of allVehicles) for(const season of seasonFixture(v)) {
      await db.query(`INSERT INTO seasons(id,company_id,vehicle_id,start_date,end_date,rate,name)
        SELECT $1,$2,$3,$4,$5,$6,$7
        WHERE NOT EXISTS(SELECT 1 FROM seasons s WHERE s.company_id=$2 AND (s.vehicle_id=$3 OR s.vehicle_id IS NULL) AND daterange(s.start_date,s.end_date,'[)') && daterange($4::date,$5::date,'[)'))
        ON CONFLICT(id) DO NOTHING`,[season.id,season.company_id,season.vehicle_id,season.start_date,season.end_date,season.rate,season.name]);
    }
    const travelers=(await db.query('SELECT * FROM users WHERE email=ANY($1::text[]) ORDER BY email',[fixture.travelers.map(u=>u.email)])).rows;
    const owners=(await db.query("SELECT * FROM users WHERE role='owner' AND company_id=ANY($1::text[]) ORDER BY company_id,email",[companyIds])).rows;
    activity=await populateWorldActivity(db,{companies:allCompanies,vehicles:allVehicles,travelers,owners,now});
    if(travelers.length!==1000) throw Error(`Liczba testowych podróżników: ${travelers.length}, oczekiwano1000.`);
    const distribution=(await db.query(`SELECT count(*) FILTER(WHERE n=1)::int single,count(*) FILTER(WHERE n BETWEEN 2 AND 9)::int multi,count(*)::int total FROM (SELECT c.id,count(v.id)::int n FROM companies c JOIN vehicles v ON v.company_id=c.id WHERE c.id=ANY($1::text[]) GROUP BY c.id) fleets`,[companyIds])).rows[0];
    if(distribution.single!==120 || distribution.multi!==30 || distribution.total!==150 || allVehicles.length!==267) throw Error('Nieprawidłowa końcowa wielkość demonstracyjnego katalogu: '+JSON.stringify({...distribution,vehicles:allVehicles.length}));
    // Protect all records present before this run, including their password hashes.
    const afterUsers=(await db.query('SELECT id,email,password_hash,role,company_id FROM users WHERE id=ANY($1::uuid[])',[beforeUsers.map(u=>u.id)])).rows;
    for(const previous of beforeUsers) {
      const current=afterUsers.find(u=>u.id===previous.id);
      if(!current || ['email','password_hash','role','company_id'].some(k=>current[k]!==previous[k])) throw Error('Naruśono istniejące konto; import zostanie wycofany.');
    }
    const privateCompanyIds=beforeCompanies.filter(c=>!companyIds.includes(c.id)).map(c=>c.id);
    const privateAfter=(await db.query('SELECT * FROM companies WHERE id=ANY($1::text[]) ORDER BY id',[privateCompanyIds])).rows;
    if(JSON.stringify(privateAfter)!==JSON.stringify(beforeCompanies.filter(c=>privateCompanyIds.includes(c.id)))) throw Error('Naruszono prywatną firmę; import zostanie wycofany.');
    const vehiclesAfter=(await db.query('SELECT * FROM vehicles WHERE id=ANY($1::text[]) ORDER BY id',[beforeVehicles.map(v=>v.id)])).rows;
    if(JSON.stringify(vehiclesAfter)!==JSON.stringify(beforeVehicles)) throw Error('Naruszono istniejący pojazd; import zostanie wycofany.');
    const bookingsAfter=(await db.query('SELECT * FROM bookings WHERE id=ANY($1::uuid[]) ORDER BY id',[beforeBookings.map(b=>b.id)])).rows;
    if(JSON.stringify(bookingsAfter)!==JSON.stringify(beforeBookings)) throw Error('Naruszono istniejącą rezerwację; import zostanie wycofany.');
    const stockAfter=(await db.query('SELECT * FROM stock_items ORDER BY company_id,id')).rows.filter(s=>beforeStock.some(b=>b.company_id===s.company_id&&b.id===s.id));
    if(JSON.stringify(stockAfter)!==JSON.stringify(beforeStock)) throw Error('Naruszono istniejący magazyn; import zostanie wycofany.');
  }
  const users=(await db.query('SELECT * FROM users ORDER BY email')).rows;
  const companies=(await db.query(`SELECT c.*, (SELECT count(*)::int FROM vehicles v WHERE v.company_id=c.id) "vehicleCount", (SELECT count(*)::int FROM stock_items s WHERE s.company_id=c.id) "stockItemCount", (SELECT coalesce(sum(quantity),0)::int FROM stock_items s WHERE s.company_id=c.id) "stockUnits" FROM companies c ORDER BY name,id`)).rows;
  const vehicles=(await db.query('SELECT * FROM vehicles ORDER BY company_id,name,id')).rows;
  const stock=(await db.query(`SELECT s.*, ARRAY(SELECT sv.vehicle_id FROM stock_item_vehicles sv WHERE sv.company_id=s.company_id AND sv.item_id=s.id ORDER BY sv.vehicle_id) vehicle_ids FROM stock_items s ORDER BY company_id,id`)).rows;
  const tableNames=['bookings','messages','comments','reports','handovers','tasks','amendments','favorites','local_mail','payments','services','seasons'];
  const activityCounts={};
  for(const table of tableNames) activityCounts[table]=(await db.query(`SELECT count(*)::int count FROM ${table}`)).rows[0].count;
  const known=new Map();
  for(const filename of [path.join(local,'accounts.json'),path.join(local,'demo-accounts.json'),manifestPath]) {
    const data=await readJson(filename,[]);
    const accounts=Array.isArray(data)?data:data?.accounts||[];
    for(const a of accounts) if(a.email && a.password) known.set(a.email,a.password);
  }
  const safeUsers=[];
  for(const u of users) {
    const candidate=known.get(u.email);
    const isKnown=await verify(candidate,u.password_hash);
    const {password_hash,...safe}=u;
    safeUsers.push({...safe,login:u.email,password:isKnown?candidate:null,passwordStatus:isKnown?'Zweryfikowane z lokalnego pliku':'Hasło użytkownika — nie zapisane'});
  }
  const exportCompanies=companies.map(c=>({...c,owners:safeUsers.filter(u=>u.company_id===c.id).map(u=>({id:u.id,email:u.email,name:u.name,password:u.password,passwordStatus:u.passwordStatus})),fleetGroup:c.vehicleCount===1?'1 auto':c.vehicleCount>=2&&c.vehicleCount<=9?'2–9 aut':c.vehicleCount===0?'Bez aut':'10+ aut'}));
  const previousExport=args.has('--export-only')?await readJson(exportPath,{}):{};
  const summary={users:users.length,travelers:users.filter(u=>u.role==='traveler').length,demoTravelers:users.filter(u=>fixture.travelers.some(a=>a.email===u.email)).length,owners:users.filter(u=>u.role==='owner').length,admins:users.filter(u=>u.role==='admin').length,companies:companies.length,demoCompanies:companies.filter(c=>companyIds.includes(c.id)).length,companiesWithOneVehicle:companies.filter(c=>companyIds.includes(c.id)&&c.vehicleCount===1).length,companiesWith2To9Vehicles:companies.filter(c=>companyIds.includes(c.id)&&c.vehicleCount>=2&&c.vehicleCount<=9).length,companiesWithoutVehicles:companies.filter(c=>c.vehicleCount===0).length,vehicles:vehicles.length,stockItems:stock.length,stockUnits:stock.reduce((n,s)=>n+s.quantity,0),knownPasswords:safeUsers.filter(u=>u.password!==null).length,insertedUsers,insertedCompanies,insertedVehicles};
  const exportData={generatedAt:new Date().toISOString(),version:WORLD_DEMO_VERSION,fictional:true,portalUrl:'https://vanly.me.local',ownerPortalUrl:'https://owner.vanly.me.local',adminPortalUrl:'https://admin.vanly.me.local',users:safeUsers,companies:exportCompanies,vehicles,stock,summary,activityCounts,demoActivityCounts:activity.activityCounts||previousExport.demoActivityCounts||{},sampleScenarios:activity.sampleScenarios?.length?activity.sampleScenarios:previousExport.sampleScenarios||[],backupDir:backupDir||previousExport.backupDir||null};
  await grantDemoPublications(db,newCreditVehicleIds);
  await db.query('COMMIT'); inTransaction=false;
  await privateWrite(exportPath,exportData);
  console.log(JSON.stringify({ok:true,exportPath,backupDir,summary,activityCounts}));
} catch(error) {
  if(inTransaction) await db.query('ROLLBACK');
  throw error;
} finally { await db.end(); }
