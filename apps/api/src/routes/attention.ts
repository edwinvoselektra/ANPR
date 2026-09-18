import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ATTENTION_SCORE_CONFIG, normalizeLicensePlate, PERMISSIONS } from "@anpr/shared";
import { audit } from "../lib/audit.js";
import { requireAdmin, requirePermission } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";

const plateParams=z.object({normalized:z.string().min(2).max(20).transform(normalizeLicensePlate).refine(value=>value.length>=2)});
const publicSelect={id:true,passageId:true,normalizedLicensePlate:true,score:true,confidence:true,factorsJson:true,reasonsJson:true,calculatedAt:true,windowStart:true,windowEnd:true,review:{select:{reviewLabel:true,reviewedAt:true,reviewNote:true,reviewedBy:{select:{id:true,displayName:true}}}}} as const;
const response=(snapshot:any)=>{
  if(!snapshot)return null;
  const{factorsJson,reasonsJson,...safe}=snapshot;
  return{...safe,status:snapshot.confidence==="LOW"?"INSUFFICIENT_DATA":"SCORED",factors:factorsJson,reasons:reasonsJson};
};

export async function attentionRoutes(app:FastifyInstance){
  app.get("/attention/config",{preHandler:requireAdmin()},async()=>({active:true,minimumPassages:ATTENTION_SCORE_CONFIG.minimumHistory,analysisWindowDays:ATTENTION_SCORE_CONFIG.windowDays,attentionThreshold:ATTENTION_SCORE_CONFIG.repeatedAnomalyThreshold,editable:false}));

  app.get("/attention/patterns",{preHandler:requirePermission(PERMISSIONS.PASSAGES_VIEW)},async(request,reply)=>{
    const query=z.object({minScore:z.coerce.number().int().min(0).max(100).default(0),confidence:z.enum(["LOW","MEDIUM","HIGH"]).optional(),dateFrom:z.coerce.date().optional(),dateTo:z.coerce.date().optional(),cameraId:z.string().uuid().optional(),location:z.string().trim().max(120).optional(),limit:z.coerce.number().int().min(1).max(100).default(50)}).parse(request.query);
    const snapshots=await prisma.attentionSnapshot.findMany({where:{expiresAt:{gt:new Date()},score:{gte:query.minScore},confidence:query.confidence,calculatedAt:{gte:query.dateFrom,lte:query.dateTo},passage:{status:{not:"DELETED"},cameraId:query.cameraId,location:query.location?{contains:query.location,mode:"insensitive"}:undefined}},orderBy:[{score:"desc"},{windowEnd:"desc"},{id:"desc"}],take:Math.min(5000,query.limit*20),select:{id:true,normalizedLicensePlate:true,score:true,confidence:true,reasonsJson:true,calculatedAt:true,windowEnd:true,passage:{select:{displayLicensePlate:true,timestamp:true,timezone:true,location:true,camera:{select:{id:true,name:true,historicalName:true,vpnLocation:{select:{timezone:true}}}}}}}});
    const latest=new Map<string,typeof snapshots[number]>();
    for(const snapshot of snapshots)if(!latest.has(snapshot.normalizedLicensePlate))latest.set(snapshot.normalizedLicensePlate,snapshot);
    const patterns=[...latest.values()].slice(0,query.limit).map(snapshot=>{const passage=snapshot.passage;const timeZone=passage.timezone??passage.camera?.vpnLocation?.timezone;return{ id:snapshot.id,normalizedLicensePlate:snapshot.normalizedLicensePlate,displayLicensePlate:passage.displayLicensePlate,score:snapshot.score,confidence:snapshot.confidence,reasons:snapshot.reasonsJson,calculatedAt:snapshot.calculatedAt,lastPassageAt:passage.timestamp,timeZone,location:passage.location,camera:passage.camera?{id:passage.camera.id,name:passage.camera.historicalName??passage.camera.name}:null};});
    return reply.header("Cache-Control","private, no-store").send({patterns});
  });

  app.get("/attention/:normalized",{preHandler:requirePermission(PERMISSIONS.PASSAGES_VIEW)},async(request,reply)=>{
    const{normalized}=plateParams.parse(request.params);
    const snapshot=await prisma.attentionSnapshot.findFirst({where:{normalizedLicensePlate:normalized,expiresAt:{gt:new Date()},passage:{status:{not:"DELETED"}}},orderBy:[{windowEnd:"desc"},{id:"desc"}],select:publicSelect});
    return reply.header("Cache-Control","private, no-store").send({normalizedLicensePlate:normalized,attention:response(snapshot)});
  });

  app.get("/attention/:normalized/history",{preHandler:requirePermission(PERMISSIONS.PASSAGES_VIEW)},async(request,reply)=>{
    const{normalized}=plateParams.parse(request.params);const{limit}=z.object({limit:z.coerce.number().int().min(1).max(100).default(25)}).parse(request.query);
    const snapshots=await prisma.attentionSnapshot.findMany({where:{normalizedLicensePlate:normalized,expiresAt:{gt:new Date()},passage:{status:{not:"DELETED"}}},orderBy:[{windowEnd:"desc"},{id:"desc"}],take:limit,select:publicSelect});
    return reply.header("Cache-Control","private, no-store").send({normalizedLicensePlate:normalized,history:snapshots.map(response)});
  });

  app.put("/attention/:id/review",{preHandler:requireAdmin()},async(request)=>{
    const{id}=z.object({id:z.string().uuid()}).parse(request.params);
    const body=z.object({reviewLabel:z.enum(["NORMAL","ATTENTION","SUSPICIOUS_PATTERN","INSUFFICIENT_INFO"]),reviewNote:z.string().trim().max(1000).nullable().optional()}).parse(request.body);
    const snapshot=await prisma.attentionSnapshot.findFirstOrThrow({where:{id,expiresAt:{gt:new Date()},passage:{status:{not:"DELETED"}}},include:{review:true}});
    const review=await prisma.patternReview.upsert({where:{snapshotId:id},create:{snapshotId:id,reviewLabel:body.reviewLabel,reviewNote:body.reviewNote||null,reviewedById:request.authUser!.id},update:{reviewLabel:body.reviewLabel,reviewNote:body.reviewNote||null,reviewedById:request.authUser!.id,reviewedAt:new Date()}});
    await audit(request,snapshot.review?"PATTERN_REVIEW_UPDATED":"PATTERN_REVIEW_CREATED",{objectType:"AttentionSnapshot",objectId:id,oldValue:snapshot.review?{reviewLabel:snapshot.review.reviewLabel}:undefined,newValue:{reviewLabel:review.reviewLabel},metadata:{normalizedLicensePlate:snapshot.normalizedLicensePlate}});
    return{review:{reviewLabel:review.reviewLabel,reviewedAt:review.reviewedAt,reviewNote:review.reviewNote}};
  });
}
