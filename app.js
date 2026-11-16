(() => {
'use strict';
const $ = id => document.getElementById(id);
const cfg = window.HD_CONFIG || {};
const configured = /^https:\/\//.test(cfg.supabaseUrl || '') && !!cfg.supabaseAnonKey && !cfg.supabaseAnonKey.startsWith('YOUR_');
if (!configured || !window.supabase) { $('setup').classList.remove('hidden'); $('login').classList.add('hidden'); return; }
const db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
let currentUser = null, currentRole = null, currentAssets = [], page = 0;
const show = (id, yes) => $(id).classList.toggle('hidden', !yes);
const msg = (id, message, isError=false) => { $(id).textContent = message; $(id).className = 'message ' + (isError ? 'error' : 'success'); };
const money = n => '₹' + Number(n || 0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const esc = x => String(x ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function table(headers, rows, widths=false){return `<table><thead><tr>${headers.map((h,i)=>`<th class="${i===headers.length-1?'money':''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(row=>`<tr>${row.map((cell,i)=>`<td class="${i===row.length-1?'money':''}">${esc(cell)}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${headers.length}">No asset records</td></tr>`}</tbody></table>`;}
async function loadSession(){
 const {data:{user},error} = await db.auth.getUser();
 if(error || !user){currentUser=null;currentRole=null;show('login',true);show('app',false);show('account',false);return;}
 const {data:profile,error:pe} = await db.from('profiles').select('role,active').eq('user_id',user.id).maybeSingle();
 if(pe || !profile || !profile.active){await db.auth.signOut();msg('loginMessage','Your account has not been activated. Contact the administrator.',true);show('login',true);show('app',false);show('account',false);return;}
 currentUser=user;currentRole=profile.role;
 $('email').textContent=user.email||'';$('role').textContent=profile.role==='admin'?'Administrator':'Field user';
 show('login',false);show('app',true);show('account',true);show('adminPanel',profile.role==='admin');
}
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();msg('loginMessage','Signing in...');const {error}=await db.auth.signInWithPassword({email:$('loginEmail').value.trim(),password:$('loginPassword').value});if(error)msg('loginMessage',error.message,true);else await loadSession();});
$('logout').addEventListener('click',async()=>{await db.auth.signOut();show('result',false);$('hdSearch').value='';await loadSession();});
$('toggleUpload').addEventListener('click',()=>{const hidden=$('uploadArea').classList.toggle('hidden');$('toggleUpload').textContent=hidden?'Show upload area':'Hide upload area';});
const clean = s => String(s??'').trim();
const norm = s => clean(s).toLowerCase().replace(/[^a-z0-9]/g,'');
const alias = {
 hd_code:['hdcode','hdnumber','hdid','distributorcode','customercode'],
 hd_name:['hdname','distributorname','customername'],location:['location','town','city'],
 rsm:['rsm','rsmname'],zsm:['zsm','zsmname'],sdm:['sdm','sdmname'],
 total_deposit:['totaldeposit','totaldepositvalue','depositamount','totaldeposite'],
 security_deposit:['securitydeposit','securitydeposite','securityamount'],
 asset_tag:['assettag','assettagnumber','assetcode','assetnumber','tag','tagnumber'],
 capacity:['assetcapacity','capacity','freezercapacity','coolercapacity','assetdescription','model'],
 asset_value:['assetvalue','assetbookvalue','bookvalue','value','netbookvalue']
};
function parseMoney(v){if(typeof v==='number')return v;const s=clean(v).replace(/[₹,\s]/g,'');if(!s)return 0;const n=Number(s);if(!Number.isFinite(n))throw Error('Invalid monetary value: '+v);return n;}
function readWorkbook(file,kind){return new Promise((resolve,reject)=>{
 const reader=new FileReader();reader.onerror=()=>reject(Error('Cannot read '+file.name));reader.onload=()=>{try{
 if(!window.XLSX)throw Error('Excel library did not load. Check internet connection.');
 const wb=XLSX.read(reader.result,{type:'array',raw:false});
 const required=kind==='master'?['hd_code','hd_name','total_deposit','security_deposit']:['hd_code','asset_tag','capacity','asset_value'];
 let best=null;
 for(const name of wb.SheetNames){const rows=XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,defval:'',raw:false});
 for(let h=0;h<Math.min(12,rows.length);h++){
 const heads=rows[h].map(norm);const ix={};for(const [field,choices] of Object.entries(alias)){ix[field]=heads.findIndex(x=>choices.includes(x));}
 if(required.every(k=>ix[k]>=0)){best={rows,ix,h,name};break;}}
 if(best)break;}
 if(!best)throw Error(`No worksheet found with required ${kind} columns: ${required.join(', ')}`);
 const result=[];
 for(let i=best.h+1;i<best.rows.length;i++){
 const row=best.rows[i];if(row.every(x=>!clean(x)))continue;
 const obj={};for(const field of Object.keys(alias))if(best.ix[field]>=0)obj[field]=clean(row[best.ix[field]]);
 if(!obj.hd_code)throw Error(`Blank HD Code in ${file.name}, Excel row ${i+1}`);
 if(kind==='master'){obj.total_deposit=parseMoney(obj.total_deposit);obj.security_deposit=parseMoney(obj.security_deposit);delete obj.asset_tag;delete obj.capacity;delete obj.asset_value;}
 else{obj.asset_value=parseMoney(obj.asset_value);for(const f of ['hd_name','location','rsm','zsm','sdm','total_deposit','security_deposit'])delete obj[f];}
 result.push(obj);}
 resolve(result);
 }catch(err){reject(err);}};reader.readAsArrayBuffer(file);});}
$('importBtn').addEventListener('click',async()=>{
 if(currentRole!=='admin')return;
 const a=$('assetsFile').files[0],m=$('masterFile').files[0];if(!a||!m){msg('importMessage','Select both Excel files.',true);return;}
 const btn=$('importBtn');btn.disabled=true;msg('importMessage','Reading and validating both files...');
 try{
 const [assets,masters]=await Promise.all([readWorkbook(a,'assets'),readWorkbook(m,'master')]);
 if(!masters.length)throw Error('HD master is empty.');
 const codes=new Set(masters.map(x=>x.hd_code));if(codes.size!==masters.length)throw Error('Duplicate HD Codes in master.');
 const unknown=[...new Set(assets.filter(x=>!codes.has(x.hd_code)).map(x=>x.hd_code))];if(unknown.length)throw Error('Assets have HD Codes absent from master: '+unknown.slice(0,5).join(', '));
 if(!confirm(`Replace ALL existing cloud data with ${masters.length} HD records and ${assets.length} asset rows?`))throw Error('Upload cancelled.');
 msg('importMessage','Uploading to Supabase. Please wait...');
 const {data,error}=await db.rpc('replace_hd_dataset',{p_master:masters,p_assets:assets});if(error)throw Error(error.message);
 msg('importMessage',`Uploaded successfully: ${data.hd_count} HDs and ${data.asset_count} assets. Refresh search to see updates.`);
 }catch(err){msg('importMessage',err.message,true);}finally{btn.disabled=false;}
});
async function fetchAllAssets(code){let out=[],from=0;const size=1000;for(;;){const {data,error}=await db.from('assets').select('asset_tag,capacity,asset_value').eq('hd_code',code).order('id',{ascending:true}).range(from,from+size-1);if(error)throw Error(error.message);out.push(...data);if(data.length<size)break;from+=size;if(from>200000)throw Error('Too many assets for one HD');}return out;}
async function search(){const code=clean($('hdSearch').value);show('result',false);if(!code){msg('searchMessage','Enter an HD Code.',true);return;}msg('searchMessage','Searching...');try{
 const {data:hd,error}=await db.from('hd_master').select('*').eq('hd_code',code).maybeSingle();if(error)throw Error(error.message);if(!hd){msg('searchMessage','No HD found for this exact code.',true);return;}
 const assets=await fetchAllAssets(code);currentAssets=assets;page=0;
 const info=[['HD Code',hd.hd_code],['HD Name',hd.hd_name],['Location',hd.location],['RSM',hd.rsm],['ZSM',hd.zsm],['SDM',hd.sdm]];
 $('hdInfo').innerHTML=info.map(([k,v])=>`<div class="info-item"><small>${esc(k)}</small><b>${esc(v||'—')}</b></div>`).join('');
 const total=assets.reduce((s,x)=>s+Number(x.asset_value||0),0),bal=Number(hd.total_deposit||0)-Number(hd.security_deposit||0)-total;
 const cards=[['Asset Count',assets.length],['Asset Value',money(total)],['Total Deposit',money(hd.total_deposit)],['Security Deposit',money(hd.security_deposit)],['Available Balance',money(bal)]];
 $('kpis').innerHTML=cards.map(([k,v])=>`<div class="kpi"><small>${esc(k)}</small><strong>${esc(v)}</strong></div>`).join('');
 const groups=new Map();for(const x of assets){const k=x.capacity||'Unspecified';const g=groups.get(k)||{count:0,value:0};g.count++;g.value+=Number(x.asset_value||0);groups.set(k,g);}
 const rows=[...groups].sort((a,b)=>a[0].localeCompare(b[0])).map(([k,v])=>[k,v.count,money(v.value)]);rows.push(['GRAND TOTAL',assets.length,money(total)]);
 $('capacity').innerHTML=table(['Asset Capacity','Asset Count','Total Asset Value'],rows);
 renderAssetTables();show('result',true);msg('searchMessage',`Showing HD ${code}.`);
 }catch(err){msg('searchMessage',err.message,true);}}
function renderAssetTables(){const start=page*40;const chunk=currentAssets.slice(start,start+40);const format=x=>[x.asset_tag,x.capacity,money(x.asset_value)];
 const headers=['#','Asset Tag','Capacity','Asset Value'];
 const make=(arr,offset)=>table(headers,arr.map((x,i)=>[start+offset+i+1,...format(x)]));
 $('leftTable').innerHTML=make(chunk.slice(0,20),0);$('rightTable').innerHTML=make(chunk.slice(20,40),20);
 $('pageLabel').textContent=currentAssets.length?`${start+1}–${Math.min(start+40,currentAssets.length)} of ${currentAssets.length}`:'0 assets';
 $('prevPage').disabled=page===0;$('nextPage').disabled=start+40>=currentAssets.length;
}
$('searchBtn').addEventListener('click',search);$('hdSearch').addEventListener('keydown',e=>{if(e.key==='Enter')search();});
$('clearBtn').addEventListener('click',()=>{$('hdSearch').value='';show('result',false);msg('searchMessage','Enter an HD Code to begin.');});
$('prevPage').addEventListener('click',()=>{if(page>0){page--;renderAssetTables();}});
$('nextPage').addEventListener('click',()=>{if((page+1)*40<currentAssets.length){page++;renderAssetTables();}});
loadSession();
})();
