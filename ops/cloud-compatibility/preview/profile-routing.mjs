import{execFileSync}from'node:child_process';
const ports=Object.freeze({test:Object.freeze({apiPort:55321,frontendPort:55173}),staging:Object.freeze({apiPort:56321,frontendPort:56173})});
export function validateRouting(record,expected){
 if(!Object.hasOwn(ports,expected)||record?.profile!==expected||record.apiPort!==ports[expected].apiPort||record.frontendPort!==ports[expected].frontendPort||typeof record.publishableKey!=='string'||!record.publishableKey.startsWith('sb_publishable_'))throw Error('Owned profile routing mismatch');
 return Object.freeze({...record});
}
export function loadRouting(){
 const selected=process.env.BARBER_CLOUD_PROFILE;
 if(process.env.BARBER_PROXY_FIXTURE==='1'){
  if(process.env.BARBER_LIVE_APPROVED==='1'||process.env.BARBER_ORIGIN_PIN_PATH)throw Error('Fixture routing cannot host');
  return validateRouting({profile:'test',...ports.test,publishableKey:'sb_publishable_DUMMY'},'test');
 }
 if(!Object.hasOwn(ports,selected||''))throw Error('Explicit owned cloud profile required');
 let record;try{record=JSON.parse(execFileSync('python3',[new URL('../runtime/export-route.py',import.meta.url).pathname,selected],{encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe']}));}catch{throw Error('Owned profile validation failed');}
 return validateRouting(record,selected);
}
