// 알레프 수호령 마무리: 이 PC의 상태를 읽어 보여 주는 로컬 수집기.
// 읽기 전용이다. 방화벽·이벤트·네트워크·디스크를 바꾸는 명령이나 인자는 어디에도 없다.
// 각 부분이 실패하면 그 부분만 확인 불가로 둔다. 실패를 숨기거나 가짜 값을 넣지 않는다.
import {cpus,freemem,totalmem,networkInterfaces,platform} from 'node:os';
import {statfs} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {lookup} from 'node:dns/promises';

const aborted=()=>Object.assign(new Error('REQUEST_CANCELLED'),{code:'REQUEST_CANCELLED'});
const cut=(value,max)=>typeof value==='string'?[...value].map(c=>{const n=c.codePointAt(0);return n<32||n===127?' ':c;}).join('').trim().slice(0,max):'';
const percent=(part,whole)=>Number.isFinite(whole)&&whole>0?Math.round(part/whole*1000)/10:0;
const partFail=()=>({ok:false});

function sleep(ms,signal){
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(aborted());return;}
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',onAbort);resolve();},ms);
    const onAbort=()=>{clearTimeout(timer);reject(aborted());};
    signal?.addEventListener('abort',onAbort,{once:true});
  });
}

// 자식 프로세스는 읽기 전용 명령만 받는다. timeout 이 넘으면 죽이고, 요청이 끊기면 함께 죽인다.
function runCommand(file,args,{signal,timeoutMs}){
  return new Promise(resolve=>{
    let child;
    try{child=execFile(file,args,{timeout:timeoutMs,windowsHide:true,maxBuffer:1<<20},(error,stdout)=>{
      cleanup();
      if(error)resolve({ok:false,killed:error.killed===true});
      else resolve({ok:true,stdout:String(stdout)});
    });}catch{resolve({ok:false,killed:false});return;}
    const onAbort=()=>{try{child.kill('SIGKILL');}catch{}};
    const cleanup=()=>signal?.removeEventListener('abort',onAbort);
    if(signal){if(signal.aborted)onAbort();else signal.addEventListener('abort',onAbort,{once:true});}
  });
}

// os.cpus() 의 누적 시간 차이로 실제 사용률을 잰다. 즉시값이 아니라 약 0.25초 표본이다.
function cpuTimes(){
  return cpus().map(cpu=>{const t=cpu.times;return {idle:t.idle,total:t.user+t.nice+t.sys+t.idle+t.irq};});
}

async function readCpu(signal){
  const first=cpuTimes();
  await sleep(250,signal);
  const second=cpuTimes();
  let busy=0,total=0;
  for(let i=0;i<Math.min(first.length,second.length);i++){
    const dt=second[i].total-first[i].total,di=second[i].idle-first[i].idle;
    if(dt>0){busy+=dt-di;total+=dt;}
  }
  if(total<=0)throw new Error('CPU_SAMPLE_EMPTY');
  const model=(cpus()[0]||{}).model||'';
  return {ok:true,usagePercent:percent(busy,total),cores:second.length,model:cut(model,120)};
}

function readMemory(){
  const total=totalmem(),free=freemem();
  if(!Number.isFinite(total)||total<=0)throw new Error('MEM_INVALID');
  return {ok:true,totalBytes:total,usedBytes:total-free,usagePercent:percent(total-free,total)};
}

async function readDisk(){
  const root=platform()==='win32'?`${process.env.SystemDrive||'C:'}\\`:'/';
  const fs=await statfs(root);
  const total=fs.blocks*fs.bsize,available=fs.bavail*fs.bsize;
  if(!Number.isFinite(total)||total<=0)throw new Error('DISK_INVALID');
  return {ok:true,root:cut(root,32),totalBytes:total,availableBytes:available,usedBytes:total-available,usagePercent:percent(total-available,total)};
}

async function readSystem(signal){
  const out={cpu:partFail(),memory:partFail(),disk:partFail()};
  try{out.cpu=await readCpu(signal);}catch(error){if(error?.code==='REQUEST_CANCELLED')throw error;}
  try{out.memory=readMemory();}catch{}
  try{out.disk=await readDisk();}catch(error){if(error?.code==='REQUEST_CANCELLED')throw error;}
  return out;
}

// 활성 IPv4 인터페이스만 보인다. MAC 주소는 화면에 필요 없어서 보내지 않는다.
function readInterfaces(){
  const list=[];
  for(const [name,addresses] of Object.entries(networkInterfaces())){
    for(const address of addresses||[]){
      // 루프백·링크로컬(169.254)은 실제 연결이 아니라서 제외한다.
      if(address.internal||address.family!=='IPv4'||address.address.startsWith('169.254.'))continue;
      list.push({name:cut(name,64),family:'IPv4',address:cut(address.address,64)});
      if(list.length>=8)return list;
    }
  }
  return list;
}

// 인터넷 연결은 DNS 이름 확인 수준으로만 판단한다. 실제 외부 접속 성공을 주장하지 않는다.
async function probeInternet(signal){
  try{
    const result=await Promise.race([lookup('www.msftconnecttest.com'),sleep(3000,signal).then(()=>null)]);
    return result===null?'unknown':'likely';
  }catch(error){
    if(error?.code==='REQUEST_CANCELLED')throw error;
    if(['ENOTFOUND','EAI_AGAIN','EAI_NONAME','ESERVFAIL','EREFUSED','ETIMEOUT'].includes(error?.code))return 'unreachable';
    return 'unknown';
  }
}

async function readNetwork(signal){
  try{return {ok:true,interfaces:readInterfaces(),internet:await probeInternet(signal)};}
  catch(error){if(error?.code==='REQUEST_CANCELLED')throw error;return {ok:false,error:{code:'LOCAL_NETWORK_UNAVAILABLE',message:'이 PC의 연결 상태를 읽을 수 없습니다.'}};}
}

// Windows 방화벽 프로필 상태만 읽는다(켜고 끄지 않는다). Windows가 아니거나 읽기가 실패하면 확인 불가.
async function readFirewall(signal){
  if(platform()!=='win32')return {ok:false,error:{code:'LOCAL_PLATFORM_UNSUPPORTED',message:'방화벽 읽기는 Windows에서만 지원합니다.'}};
  const script='[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;try{Get-NetFirewallProfile -ErrorAction Stop|Select-Object Name,Enabled|ConvertTo-Json -Compress}catch{exit 3}';
  const run=await runCommand('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{signal,timeoutMs:12000});
  if(signal?.aborted)throw aborted();
  if(!run.ok)return {ok:false,error:{code:'LOCAL_FIREWALL_UNAVAILABLE',message:run.killed?'방화벽 응답 시간이 초과됐습니다. 다시 조회하세요.':'이 PC의 방화벽 설정을 읽을 수 없습니다.'}};
  let parsed;
  try{parsed=JSON.parse(run.stdout.trim());}catch{return {ok:false,error:{code:'LOCAL_FIREWALL_UNAVAILABLE',message:'방화벽 응답을 확인할 수 없습니다.'}};}
  const names={Domain:'domain',Private:'private',Public:'public'},profiles=[];
  for(const row of Array.isArray(parsed)?parsed:[parsed]){
    const enabled=typeof row?.Enabled==='boolean'?row.Enabled:row?.Enabled===0||row?.Enabled===1?row.Enabled===1:null;
    if(row&&typeof row.Name==='string'&&names[row.Name]!==undefined&&enabled!==null)
      profiles.push({name:names[row.Name],state:enabled?'on':'off'});
    if(profiles.length>=6)break;
  }
  if(profiles.length===0)return {ok:false,error:{code:'LOCAL_FIREWALL_UNAVAILABLE',message:'방화벽 프로필을 확인할 수 없습니다.'}};
  return {ok:true,profiles};
}

// System 로그의 심각·오류·경고만 최근 12건 읽는다(쓰기·삭제 없음). 보안 로그는 읽지 않는다.
async function readEvents(signal){
  if(platform()!=='win32')return {ok:false,error:{code:'LOCAL_PLATFORM_UNSUPPORTED',message:'이벤트 로그 읽기는 Windows에서만 지원합니다.'}};
  const script='[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;'
    +'try{Get-WinEvent -FilterHashtable @{LogName=\'System\';Level=1,2,3} -MaxEvents 12 -ErrorAction Stop|'
    +'ForEach-Object{[pscustomobject]@{time=$_.TimeCreated.ToString(\'o\');id=$_.Id;level=$_.Level;provider=$_.ProviderName;'
    +'message=([string]$_.Message -replace \'\\s+\',\' \')}}|ConvertTo-Json -Compress}'
    +'catch{if($_.FullyQualifiedErrorId -match \'NoMatchingEventsFound\'){\'[]\'}else{exit 3}}';
  const run=await runCommand('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{signal,timeoutMs:12000});
  if(signal?.aborted)throw aborted();
  if(!run.ok)return {ok:false,error:{code:'LOCAL_EVENTS_UNAVAILABLE',message:run.killed?'이벤트 응답 시간이 초과됐습니다. 다시 조회하세요.':'이 PC의 이벤트 로그를 읽을 수 없습니다.'}};
  let parsed;
  try{parsed=JSON.parse(run.stdout.trim());}catch{return {ok:false,error:{code:'LOCAL_EVENTS_UNAVAILABLE',message:'이벤트 응답을 확인할 수 없습니다.'}};}
  const levels={1:'critical',2:'error',3:'warning',4:'information'},items=[];
  for(const row of Array.isArray(parsed)?parsed:[parsed]){
    if(!row||!Number.isSafeInteger(row.id)||!Number.isSafeInteger(row.level)||!Number.isFinite(Date.parse(row.time)))continue;
    items.push({at:new Date(row.time).toISOString(),id:row.id,level:levels[row.level]||'information',provider:cut(row.provider,80),message:cut(row.message,220)});
    if(items.length>=12)break;
  }
  return {ok:true,source:'System',items};
}

export async function readLocalStatus({signal}={}){
  if(signal?.aborted)throw aborted();
  const [system,network,firewall,events]=await Promise.all([
    readSystem(signal),readNetwork(signal),readFirewall(signal),readEvents(signal),
  ]);
  return {system,network,firewall,events};
}
