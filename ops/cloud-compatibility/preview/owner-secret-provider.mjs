// NOT USED WITH REAL CREDENTIALS. Future owner review required.
import fs from'node:fs';import path from'node:path';import{execFile}from'node:child_process';import{promisify}from'node:util';
const run=promisify(execFile);
// Adapter for the official SDK's documented async userTokenCallback. This module
// neither logs in nor performs network requests. There is deliberately no file fallback.
export function makeCredentialProvider(root){
 const real=fs.realpathSync(root),s=fs.statSync(real);if(real!==path.resolve(root)||s.uid!==process.getuid()||(s.mode&0o777)!==0o700||Number(fs.statfsSync(real).type)!==0x01021994)throw Error('Private owned tmpfs root required');
 for(const name of ['XDG_DATA_HOME','XDG_CONFIG_HOME','XDG_CACHE_HOME','XDG_RUNTIME_DIR']){const p=fs.realpathSync(process.env[name]||'/');if(!p.startsWith(real+'/')||(fs.statSync(p).mode&0o777)!==0o700)throw Error('Isolated private XDG selectors required');}
 if(!process.env.DBUS_SESSION_BUS_ADDRESS||!process.env.GNOME_KEYRING_CONTROL?.startsWith(real+'/'))throw Error('Private Secret Service context required');
 const tool=process.env.BARBER_SECRET_TOOL;if(!tool||!path.isAbsolute(tool))throw Error('Explicit isolated secret-tool path required');
 return async()=>{let r;try{r=await run(tool,['lookup','application','barber-private-owner-review','purpose','creator-github'],{timeout:5000,maxBuffer:4096,encoding:'utf8'});}catch{throw Error('Secure credential unavailable; no fallback permitted');}
 const value=r.stdout;if(!value||/[\r\n]/.test(value)||value.length>4096)throw Error('Invalid secure credential; no fallback permitted');return 'github '+value;};
}
