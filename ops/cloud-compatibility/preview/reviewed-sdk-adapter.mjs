// Prepared, NOT executed against any service. No login, tokens or authorization flow.
import fs from 'node:fs';import tls from 'node:tls';import {createRequire} from 'node:module';
import {HttpsProxyAgent} from './sdk-scratch/node_modules/https-proxy-agent/dist/index.js';
import {plan} from './host-helper.mjs';import{prepareEndpointClient}from'./endpoint-preparation.mjs';
const require=createRequire(new URL('./sdk-scratch/package.json',import.meta.url));
const {TunnelManagementHttpClient,ManagementApiVersions}=require('@microsoft/dev-tunnels-management');
const {TunnelRelayTunnelHost}=require('@microsoft/dev-tunnels-connections');const axios=require('axios');
export function reviewedAdapters({ownerApproved=false,credentialProvider}){
 if(ownerApproved!==true||typeof credentialProvider!=='function')throw Error('Separate owner review and encrypted credential provider required');
 if(!process.env.HTTPS_PROXY)throw Error('Mandatory inherited proxy required');
 const ca=fs.readFileSync(process.env.BARBER_CA_BUNDLE);
 class Agent extends HttpsProxyAgent{async connect(req,opts){if(![plan.control,plan.relay].includes(opts.host)||Number(opts.port)!==443||!opts.secureEndpoint)throw Error('Unreviewed TLS destination denied');return super.connect(req,{...opts,ca,rejectUnauthorized:true,checkServerIdentity:tls.checkServerIdentity,servername:opts.host});}}
 const agent=new Agent(process.env.HTTPS_PROXY);const http=axios.getAdapter('http');let newId;
 const adapter=async c=>{const u=new URL(c.url);if(u.hostname!==plan.control||u.protocol!=='https:'||u.port&&u.port!=='443')throw Error('Unreviewed control endpoint denied');if(!newId||!(u.pathname==='/tunnels/'+newId||u.pathname.startsWith('/tunnels/'+newId+'/'))||!['GET','PUT','DELETE'].includes(c.method.toUpperCase()))throw Error('Resource/method outside new-ID scope denied');return http({...c,proxy:false,httpsAgent:agent,maxRedirects:0,timeout:10000});};
 const client=new TunnelManagementHttpClient({name:'barber-private-review',version:'1'},ManagementApiVersions.Version20230927preview,async()=>{try{return await credentialProvider();}catch{throw Error('Secure credential unavailable');}},'https://'+plan.control,agent,adapter);
 client.trace=()=>{}; // Never emit SDK request/response/header diagnostics.
 // SDK cancellation tokens are provided by its pinned cancellation package.
 const {CancellationTokenSource}=require('vscode-jsonrpc');
 const withCancel=async(signal,op)=>{const source=new CancellationTokenSource();const cancel=()=>source.cancel();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();try{return await op(source.token);}finally{signal?.removeEventListener('abort',cancel);source.dispose();}};
 return {management:{createTunnel:(s,o,signal)=>{if(newId||s.clusterId!==plan.region||!/^barber-[0-9a-f]{24}$/.test(s.tunnelId))throw Error('New-resource-only guard');newId=s.tunnelId;return withCancel(signal,t=>client.createTunnel(s,o,t));},deleteTunnel:s=>{if(s.tunnelId!==newId||s.clusterId!==plan.region)throw Error('Cleanup identity mismatch');return client.deleteTunnel(s);}},makeHost:({identity,beforeRelay,record,signal})=>{let h;const guarded=prepareEndpointClient(client,{identity,beforeRelay,record,signal,controlOrigin:'https://'+plan.control,enableForwarding:()=>{h.forwardConnectionsToLocalPorts=true;}});h=new TunnelRelayTunnelHost(guarded,()=>{});h.forwardConnectionsToLocalPorts=false;return {connect:(t,o,s)=>withCancel(s,c=>h.connect(t,{...o,httpAgent:agent},c)),dispose:()=>h.dispose()};},destroy:()=>agent.destroy()};
}
