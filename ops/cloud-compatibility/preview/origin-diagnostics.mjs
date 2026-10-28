// Diagnostics ONLY. Nothing here grants access or selects an origin.
const keys=['inputType','parse','scheme','default443','userinfoPresent','queryPresent','fragmentPresent','pathClass','knownNewId','knownPort','knownRegion','canonicalAfterNormalization','serviceOwnedHost','hostnameTemplate'];
const booleans=['default443','userinfoPresent','queryPresent','fragmentPresent','canonicalAfterNormalization','serviceOwnedHost'];
const types={inputType:['STRING','OTHER'],parse:['PARSED','INVALID','NOT_STRING'],scheme:['HTTPS','HTTP','WSS','OTHER','UNAVAILABLE'],pathClass:['ROOT','NON_ROOT','EMPTY','UNAVAILABLE'],knownNewId:['MATCH','MISMATCH','ABSENT'],knownPort:['MATCH','MISMATCH','ABSENT'],knownRegion:['MATCH','MISMATCH','ABSENT']};
export function validateUriDiagnostic(d){
 if(!d||Object.keys(d).some(k=>!keys.includes(k)))throw Error('Unexpected URI diagnostic field');
 for(const [key,allowed]of Object.entries(types))if(!allowed.includes(d[key]))throw Error('Invalid URI diagnostic category');
 for(const k of booleans)if(typeof d[k]!=='boolean')throw Error('Invalid URI diagnostic flag');
 if(d.hostnameTemplate!==undefined&&(!d.serviceOwnedHost||d.hostnameTemplate.length>128||!(/^(?:devtunnels\.ms|\{other\}\.devtunnels\.ms|\{newId\}[0-9-]*(?:\.[a-z]{2,8}[0-9]{0,2})?\.devtunnels\.ms)$/).test(d.hostnameTemplate)))throw Error('Unbounded hostname template forbidden');
 return d;
}
export function inspectUri(raw,id){
 const d={inputType:typeof raw==='string'?'STRING':'OTHER',parse:typeof raw==='string'?'INVALID':'NOT_STRING',scheme:'UNAVAILABLE',default443:false,userinfoPresent:false,queryPresent:false,fragmentPresent:false,pathClass:'UNAVAILABLE',knownNewId:'ABSENT',knownPort:'ABSENT',knownRegion:'ABSENT',canonicalAfterNormalization:false,serviceOwnedHost:false};
 if(typeof raw!=='string'||!/^barber-[0-9a-f]{24}$/.test(id))return validateUriDiagnostic(d);
 let u;try{u=new URL(raw);}catch{return validateUriDiagnostic(d);}
 d.parse='PARSED';d.scheme=({'https:':'HTTPS','http:':'HTTP','wss:':'WSS'})[u.protocol]||'OTHER';d.default443=['https:','wss:'].includes(u.protocol)&&!u.port;
 const authority=raw.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i)?.[1]||'';
 d.userinfoPresent=authority.includes('@')||!!u.username||!!u.password;
 d.queryPresent=u.href.includes('?');d.fragmentPresent=u.href.includes('#');d.pathClass=u.pathname==='/'?'ROOT':u.pathname?'NON_ROOT':'EMPTY';
 const labels=u.hostname.split('.');const first=labels[0]||'';const parsed=first.match(/^(barber-[0-9a-f]{24})(.*)$/);
 if(parsed){d.knownNewId=parsed[1]===id?'MATCH':'MISMATCH';const port=parsed[2].match(/^-+([0-9]{1,5})-*$/)?.[1]||u.port;d.knownPort=port?Number(port)===5180?'MATCH':'MISMATCH':'ABSENT';}
 d.serviceOwnedHost=u.hostname==='devtunnels.ms'||u.hostname.endsWith('.devtunnels.ms');
 if(d.serviceOwnedHost){
  d.knownRegion=labels.length===4?(labels[1]==='use'?'MATCH':'MISMATCH'):labels.length===3?'ABSENT':'MISMATCH';
  const candidate=u.hostname.replaceAll(id,'{newId}');
  // Keep only confirmed-ID/number/separator/short-region templates. Mask every other label.
  d.hostnameTemplate=u.hostname==='devtunnels.ms'?'devtunnels.ms':candidate.length<=128&&/^\{newId\}[0-9-]*(?:\.[a-z]{2,8}[0-9]{0,2})?\.devtunnels\.ms$/.test(candidate)?candidate:'{other}.devtunnels.ms';
 }
 const expected=`https://${id}-5180.use.devtunnels.ms`;
 d.canonicalAfterNormalization=u.origin===expected&&u.pathname==='/'&&!d.userinfoPresent&&!d.queryPresent&&!d.fragmentPresent;
 return validateUriDiagnostic(d);
}
