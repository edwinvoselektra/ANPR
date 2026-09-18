import { ATTENTION_SCORE_CONFIG, calculateAttentionScore } from "@anpr/shared";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { ProviderLogger } from "./types.js";

const MAX_ATTEMPTS=3;
const STALE_LOCK_MS=5*60_000;

export class AttentionAnalysisService{
  constructor(private readonly options:{prisma:PrismaClient;logger:ProviderLogger}){}

  async runNext(now=new Date()):Promise<boolean>{
    const stale=new Date(now.getTime()-STALE_LOCK_MS);
    const job=await this.options.prisma.attentionAnalysisJob.findFirst({
      where:{OR:[{status:"PENDING",availableAt:{lte:now}},{status:"PROCESSING",lockedAt:{lt:stale}}]},
      orderBy:[{availableAt:"asc"},{createdAt:"asc"}],select:{id:true,passageId:true,status:true}
    });
    if(!job)return false;
    const claimed=await this.options.prisma.attentionAnalysisJob.updateMany({
      where:{id:job.id,OR:[{status:"PENDING",availableAt:{lte:now}},{status:"PROCESSING",lockedAt:{lt:stale}}]},
      data:{status:"PROCESSING",lockedAt:now,attempts:{increment:1},lastError:null}
    });
    if(claimed.count!==1)return true;
    try{
      await this.calculate(job.id,job.passageId,now);
    }catch{
      const current=await this.options.prisma.attentionAnalysisJob.findUnique({where:{id:job.id},select:{attempts:true}});
      const failed=(current?.attempts??MAX_ATTEMPTS)>=MAX_ATTEMPTS;
      await this.options.prisma.attentionAnalysisJob.updateMany({where:{id:job.id,status:"PROCESSING"},data:{status:failed?"FAILED":"PENDING",lockedAt:null,lastError:"ANALYSIS_FAILED",availableAt:new Date(now.getTime()+Math.min(300_000,30_000*2**Math.max(0,(current?.attempts??1)-1)))}});
      this.options.logger.warn(JSON.stringify({processingResult:"ATTENTION_ANALYSIS_FAILED",jobId:job.id,retry:!failed}));
    }
    return true;
  }

  private async calculate(jobId:string,passageId:string,now:Date){
    const current=await this.options.prisma.passage.findFirst({where:{id:passageId,status:{not:"DELETED"},expiresAt:{gt:now}},select:{id:true,normalizedLicensePlate:true,timestamp:true,timezone:true,cameraId:true,location:true,direction:true,expiresAt:true}});
    if(!current){await this.options.prisma.attentionAnalysisJob.delete({where:{id:jobId}});return;}
    const windowStart=new Date(current.timestamp.getTime()-ATTENTION_SCORE_CONFIG.windowDays*86_400_000);
    const [history,prior]=await Promise.all([
      this.options.prisma.passage.findMany({where:{normalizedLicensePlate:current.normalizedLicensePlate,status:{not:"DELETED"},expiresAt:{gt:now},timestamp:{gte:windowStart,lt:current.timestamp}},orderBy:{timestamp:"desc"},take:ATTENTION_SCORE_CONFIG.maxHistory,select:{timestamp:true,timezone:true,cameraId:true,location:true,direction:true}}),
      this.options.prisma.attentionSnapshot.findMany({where:{normalizedLicensePlate:current.normalizedLicensePlate,expiresAt:{gt:now},passage:{timestamp:{gte:new Date(current.timestamp.getTime()-ATTENTION_SCORE_CONFIG.repeatedWindowDays*86_400_000),lt:current.timestamp},status:{not:"DELETED"},expiresAt:{gt:now}}},orderBy:{calculatedAt:"desc"},take:10,select:{score:true}})
    ]);
    const result=calculateAttentionScore({current,history,priorAnomalyScores:prior.map(item=>item.score),calculatedAt:now});
    await this.options.prisma.$transaction(async tx=>{
      await tx.attentionSnapshot.upsert({where:{passageId},create:{passageId,normalizedLicensePlate:current.normalizedLicensePlate,score:result.score,confidence:result.confidence,factorsJson:result.factors as Prisma.InputJsonValue,reasonsJson:result.reasons as Prisma.InputJsonValue,calculatedAt:result.calculatedAt,windowStart:result.windowStart,windowEnd:result.windowEnd,expiresAt:current.expiresAt},update:{score:result.score,confidence:result.confidence,factorsJson:result.factors as Prisma.InputJsonValue,reasonsJson:result.reasons as Prisma.InputJsonValue,calculatedAt:result.calculatedAt,windowStart:result.windowStart,windowEnd:result.windowEnd,expiresAt:current.expiresAt}});
      await tx.attentionAnalysisJob.update({where:{id:jobId},data:{status:"COMPLETED",lockedAt:null,lastError:null}});
    });
  }

  async cleanup(now=new Date()){
    await this.options.prisma.attentionSnapshot.deleteMany({where:{OR:[{expiresAt:{lte:now}},{passage:{status:"DELETED"}}]}});
  }
}

export function startAttentionAnalysis(service:AttentionAnalysisService,logger:ProviderLogger){
  let running=false;let stopped=false;let cleanupCounter=0;
  const execute=async()=>{if(running||stopped)return;running=true;try{for(let count=0;count<10&&await service.runNext();count++);if(++cleanupCounter%30===0)await service.cleanup();}catch{logger.error("[attentionAnalysis] worker cycle failed");}finally{running=false}};
  void execute();const timer=setInterval(()=>void execute(),2_000);timer.unref();return()=>{stopped=true;clearInterval(timer)};
}
