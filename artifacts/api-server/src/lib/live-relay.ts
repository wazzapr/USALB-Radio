import type { IncomingMessage, ServerResponse, Server } from "node:http";
import { request as httpRequest, type ClientRequest } from "node:http";
import { ensureLiquidsoap, liquidsoapPassword, liquidsoapRunning } from "./liquidsoap";
import { WebSocket, WebSocketServer, type RawData } from "ws";

const LIVE_SOCKET_PATH="/api/live/ws";
const PCM_MAGIC=Buffer.from([0x50,0x43,0x4d,0x31]);
let broadcaster:WebSocket|null=null;
let live=false;
let broadcastMode:"pcm"|null=null;
let pcmSampleRate=44100;
let pcmChannels=2;
let startedAt:Date|null=null;
let lastAudioAt:Date|null=null;
let totalBytes=0;
const wsListeners=new Set<WebSocket>();
let feed:ClientRequest|null=null;
let feedBlocked=false;
let queue:Buffer[]=[];
let queuedBytes=0;
const MAX_QUEUE=2*1024*1024;

function wavHeader(rate:number,channels:number):Buffer{
 const h=Buffer.alloc(44);
 h.write("RIFF",0,"ascii");h.writeUInt32LE(0xffffffff,4);h.write("WAVE",8,"ascii");
 h.write("fmt ",12,"ascii");h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);
 h.writeUInt16LE(channels,22);h.writeUInt32LE(rate,24);h.writeUInt32LE(rate*channels*2,28);
 h.writeUInt16LE(channels*2,32);h.writeUInt16LE(16,34);h.write("data",36,"ascii");h.writeUInt32LE(0xffffffff,40);
 return h;
}
function clearQueue(){queue=[];queuedBytes=0;feedBlocked=false;}
function closeFeed(){const f=feed;feed=null;clearQueue();try{f?.end();}catch{}}
function flushFeed(){
 const f=feed;if(!f||feedBlocked)return;
 while(queue.length){
  const chunk=queue[0];let ok=false;
  try{ok=f.write(chunk);}catch{closeFeed();return;}
  queue.shift();queuedBytes-=chunk.length;
  if(!ok){feedBlocked=true;f.once("drain",()=>{feedBlocked=false;flushFeed();});return;}
 }
}
async function connectFeed():Promise<boolean>{
 if(feed)return true;
 if(!liquidsoapRunning() && !(await ensureLiquidsoap()))return false;
 const auth=Buffer.from(`source:${liquidsoapPassword()}`).toString("base64");
 const f=httpRequest({host:"127.0.0.1",port:8005,path:"/live",method:"PUT",
  headers:{"Content-Type":"audio/wav","Authorization":`Basic ${auth}`,"Connection":"keep-alive"}});
 feed=f;
 f.on("response",r=>{if((r.statusCode??500)>=400){console.error(`[USALB Liquidsoap feed] HTTP ${r.statusCode}`);f.destroy();}else r.resume();});
 f.on("error",e=>{console.error("[USALB Liquidsoap feed]",e.message);if(feed===f)feed=null;});
 f.on("close",()=>{if(feed===f)feed=null;});
 try{f.write(wavHeader(pcmSampleRate,pcmChannels));flushFeed();}catch{closeFeed();return false;}
 return await new Promise<boolean>(resolve=>{
  const timer=setTimeout(()=>resolve(true),1500);
  f.once("response",r=>{clearTimeout(timer);resolve((r.statusCode??500)<400);});
  f.once("error",()=>{clearTimeout(timer);resolve(false);});
 });
}
function sendJson(s:WebSocket,p:Record<string,unknown>){if(s.readyState===WebSocket.OPEN)s.send(JSON.stringify(p));}
function raw(data:RawData):Buffer{if(Buffer.isBuffer(data))return data;if(Array.isArray(data))return Buffer.concat(data);if(data instanceof ArrayBuffer)return Buffer.from(data);return Buffer.from(data);}
function announce(){for(const s of wsListeners)sendJson(s,{type:"status",live,audioMode:broadcastMode,sampleRate:pcmSampleRate,channels:pcmChannels,qualities:live?[320]:[]});}
function relay(chunk:Buffer){
 if(!broadcastMode)return;
 if(!chunk.subarray(0,4).equals(PCM_MAGIC))return;
 const pcm=chunk.subarray(4);if(!pcm.length)return;
 lastAudioAt=new Date();totalBytes+=pcm.length;
 if(!feed)void connectFeed();if(!feed)return;
 queue.push(pcm);queuedBytes+=pcm.length;
 if(queuedBytes>MAX_QUEUE){console.error("[USALB Liquidsoap feed] backpressure limit reached");reset();return;}
 flushFeed();
}
function reset(){
 broadcaster=null;live=false;broadcastMode=null;startedAt=null;lastAudioAt=null;totalBytes=0;closeFeed();
 for(const s of wsListeners){try{s.close(1000,"Broadcast ended");}catch{}}
 wsListeners.clear();
}
function sameOrigin(req:IncomingMessage){
 const origin=req.headers.origin;if(!origin)return false;
 try{return new URL(origin).host===(req.headers.host??"");}catch{return false;}
}
async function attachBroadcaster(socket:WebSocket,token:string|null,req:IncomingMessage){
 if(token!==null&&!token.trim()){socket.close(1008,"Invalid broadcaster token");return;}
 if(!token&&req.headers.origin&&!sameOrigin(req)){sendJson(socket,{type:"error",message:"Broadcaster must connect from the USALB control room."});socket.close(1008);return;}
 if(broadcaster&&broadcaster!==socket)try{broadcaster.close(1012,"Replaced by a new broadcaster");}catch{}
 broadcaster=socket;live=false;broadcastMode=null;clearQueue();
 socket.on("message",async (data,isBinary)=>{
  if(isBinary){if(live)relay(raw(data));return;}
  try{
   const m=JSON.parse(data.toString()) as {type?:string;codec?:string;mimeType?:string;pcmSampleRate?:number;pcmChannels?:number};
   if(m.type==="start"){
    if(!(m.mimeType?.includes("pcm")||m.codec==="pcm")){sendJson(socket,{type:"error",message:"USALB expects the Windows PCM broadcaster."});return;}
    broadcastMode="pcm";
    pcmSampleRate=Number.isFinite(m.pcmSampleRate)&&Number(m.pcmSampleRate)>0?Math.round(Number(m.pcmSampleRate)):44100;
    pcmChannels=Number.isFinite(m.pcmChannels)&&Number(m.pcmChannels)>0?Math.min(2,Math.max(1,Math.round(Number(m.pcmChannels)))):2;
    if(!(await ensureLiquidsoap())){sendJson(socket,{type:"error",message:"USALB Liquidsoap could not be started."});reset();return;}
    if(!(await connectFeed()) || !feed){sendJson(socket,{type:"error",message:"Could not connect the broadcaster to Liquidsoap."});reset();return;}
    live=true;startedAt=new Date();lastAudioAt=null;totalBytes=0;announce();
    sendJson(socket,{type:"ready",live:true,codec:"pcm",contentType:"audio/mpeg",qualities:[320]});
   }else if(m.type==="stop"&&broadcaster===socket)reset();
  }catch{sendJson(socket,{type:"error",message:"Invalid broadcast message."});}
 });
 socket.once("close",()=>{if(broadcaster===socket)reset()});
 socket.once("error",()=>{if(broadcaster===socket)reset()});
}
export function getLiveSnapshot(){return{streaming:live&&lastAudioAt!==null,connected:broadcaster!==null,listenerCount:0,contentType:live?"audio/mpeg":null,bitrateKbps:live?320:null,qualities:live?[320]:[],startedAt,lastAudioAt,totalBytes};}
export function handleLiveStreamRequest(_req:IncomingMessage,_res:ServerResponse){return false;}
export function attachLiveRelay(server:Server){
 const wss=new WebSocketServer({noServer:true});
 server.on("upgrade",(request,socket,head)=>{
  const url=new URL(request.url??"/",`http://${request.headers.host??"localhost"}`);
  if(url.pathname!==LIVE_SOCKET_PATH){socket.destroy();return;}
  wss.handleUpgrade(request,socket,head,client=>{
   const role=url.searchParams.get("role");const token=url.searchParams.get("key")||request.headers["x-broadcaster-token"]?.toString()||null;
   if(role==="broadcaster")void attachBroadcaster(client,token,request);
   else if(role==="listener"){wsListeners.add(client);sendJson(client,{type:"status",live,audioMode:broadcastMode,sampleRate:pcmSampleRate,channels:pcmChannels});client.once("close",()=>wsListeners.delete(client));client.once("error",()=>wsListeners.delete(client));}
   else{sendJson(client,{type:"error",message:"Choose broadcaster or listener mode."});client.close(1008,"Invalid live relay role");}
  });
 });
}