// Read-only CGI observation. Run from the project root, with TypeScript sources
// available. No passages, images, credentials, plate text or full payloads logged.
import { PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";
import { dahuaDirectionEvidence } from "@anpr/shared";
import { dahuaEventPath, openDigestStream } from "@anpr/shared/dahua";
import type { MultipartPart } from "../apps/anpr-worker/src/multipart.js";
const root=pathToFileURL(`${process.cwd()}/`);
const {decryptCredential}=await import(new URL("apps/anpr-worker/src/credentials.ts",root).href);
const {consumeMultipart}=await import(new URL("apps/anpr-worker/src/multipart.ts",root).href);
const {parseDahuaFields,normalizeDahuaEvent}=await import(new URL("apps/anpr-worker/src/providers/dahua-parser.ts",root).href);
const duration=Number(process.env.DIRECTION_CAPTURE_SECONDS??90);
if(!Number.isInteger(duration)||duration<5||duration>180)throw new Error("DIRECTION_CAPTURE_SECONDS must be 5..180");
const cameraId=process.env.DIRECTION_CAMERA_ID;
if(cameraId&&!/^[0-9a-f-]{36}$/i.test(cameraId))throw new Error("Invalid DIRECTION_CAMERA_ID");
const db=new PrismaClient({log:[]}),controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),duration*1000);
let observed:{sourceEventId?:string;cameraId:string}|undefined;
try{
  const cameras=await db.camera.findMany({where:{id:cameraId,active:true,isDraft:false,anprProvider:"DAHUA_CGI",archivedAt:null},include:{vpnLocation:{select:{timezone:true}}},take:2});
  if(cameras.length!==1)throw new Error("Select exactly one active CGI camera with DIRECTION_CAMERA_ID");
  const camera=cameras[0]!;
  const response=await openDigestStream({protocol:camera.anprHttpProtocol as "http"|"https",host:camera.rtspHost!,port:camera.anprHttpPort,path:dahuaEventPath(camera.anprChannel),username:decryptCredential(camera.rtspUsernameEncrypted,process.env.CAMERA_CREDENTIALS_KEY!),password:decryptCredential(camera.rtspPasswordEncrypted,process.env.CAMERA_CREDENTIALS_KEY!),signal:controller.signal,timeoutMs:10000});
  console.log(JSON.stringify({event:"direction_capture_started",cameraId:camera.id,durationSeconds:duration}));
  await consumeMultipart(response,{maxPartBytes:16000000,signal:controller.signal,onPart:async(part:MultipartPart)=>{
    if(!part.headers["content-type"]?.startsWith("text/plain"))return;
    const fields=parseDahuaFields(part.body);
    const event=normalizeDahuaEvent(camera,{fields});if(!event)return;
    observed={cameraId:camera.id,sourceEventId:event.sourceEventId};
    console.log(JSON.stringify({event:"cgi_direction_only",cameraId:camera.id,fields:dahuaDirectionEvidence(fields),sourceDirection:event.sourceDirection??null,mappedDirection:event.direction,mapping:camera.directionMapping,status:event.rawMetadata?.directionStatus,selectedField:event.rawMetadata?.rawDirectionField}));
    controller.abort();
  }});
}catch(error){
  // Never print underlying network/Prisma errors: they can contain URLs or credentials.
  if(!controller.signal.aborted){console.log(JSON.stringify({event:"direction_capture_unavailable"}));process.exitCode=1;}
}finally{
  clearTimeout(timer);
  if(observed?.sourceEventId){
    for(let attempt=0;attempt<5;attempt++){
      const record=await db.passage.findFirst({where:{cameraId:observed.cameraId,sourceEventId:observed.sourceEventId},select:{id:true,direction:true}}).catch(()=>null);
      if(record){console.log(JSON.stringify({event:"existing_worker_passage",passageId:record.id,direction:record.direction}));break;}
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
  }
  console.log(JSON.stringify({event:"direction_capture_finished",observed:!!observed}));
  await db.$disconnect();
}
