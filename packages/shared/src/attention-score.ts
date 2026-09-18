import { DateTime } from "luxon";
import { normalizeDirection, resolveTimeZone } from "./presentation.js";

export const ATTENTION_SCORE_CONFIG = {
  windowDays: 90,
  recentWindowDays: 7,
  mediumWindowDays: 30,
  minimumHistory: 5,
  highConfidenceHistory: 20,
  nightStartHour: 0,
  nightEndHour: 5,
  maxReasons: 4,
  maxHistory: 5000,
  repeatedWindowDays: 3,
  repeatedAnomalyThreshold: 25,
  timeFullDeviationMinutes: 360,
  frequencyStartRatio: 1.5,
  frequencyFullRatio: 4,
  nightBaselineSaturation: .4,
  minimumDirectionHistory: 5,
  reasonThreshold: 25,
  recentWeight: 3,
  mediumWeight: 2,
  olderWeight: 1,
  weights: { time: .25, dayPattern: .10, frequency: .15, night: .10, repeated: .15, location: .15, direction: .05, sequence: .05 }
} as const;

export type AttentionPassage = {
  timestamp: Date; timezone?: string | null; cameraId: string; location: string; direction: string;
};
export type AttentionFactorKey = keyof typeof ATTENTION_SCORE_CONFIG.weights;
export type AttentionFactor = { score: number; weight: number; contribution: number; available: boolean; explanation: string };
export type AttentionScoreResult = {
  score: number; confidence: "LOW"|"MEDIUM"|"HIGH"; status: "INSUFFICIENT_DATA"|"SCORED";
  factors: Record<AttentionFactorKey,AttentionFactor>; reasons: string[]; calculatedAt: Date; windowStart: Date; windowEnd: Date;
};

const clamp=(value:number)=>Math.max(0,Math.min(100,value));
const round=(value:number)=>Math.round(value*10)/10;
const circularMinutes=(a:number,b:number)=>{const distance=Math.abs(a-b);return Math.min(distance,1440-distance)};
const weightedMedian=(values:Array<{value:number;weight:number}>)=>{
  if(!values.length)return undefined;
  const sorted=[...values].sort((a,b)=>a.value-b.value);const half=sorted.reduce((sum,item)=>sum+item.weight,0)/2;let sum=0;
  for(const item of sorted){sum+=item.weight;if(sum>=half)return item.value;}return sorted.at(-1)?.value;
};
const local=(passage:AttentionPassage)=>DateTime.fromJSDate(passage.timestamp,{zone:"utc"}).setZone(resolveTimeZone(passage.timezone));
const ageWeight=(timestamp:Date,now:Date)=>{const days=(now.getTime()-timestamp.getTime())/86_400_000;return days<=ATTENTION_SCORE_CONFIG.recentWindowDays?ATTENTION_SCORE_CONFIG.recentWeight:days<=ATTENTION_SCORE_CONFIG.mediumWindowDays?ATTENTION_SCORE_CONFIG.mediumWeight:ATTENTION_SCORE_CONFIG.olderWeight};
const night=(hour:number)=>hour>=ATTENTION_SCORE_CONFIG.nightStartHour&&hour<ATTENTION_SCORE_CONFIG.nightEndHour;

function factor(score:number,weight:number,available:boolean,explanation:string):AttentionFactor{
  const normalized=available?clamp(score):0;return{score:round(normalized),weight,contribution:round(normalized*weight),available,explanation};
}

export function calculateAttentionScore(input:{current:AttentionPassage;history:AttentionPassage[];priorAnomalyScores?:number[];calculatedAt?:Date}):AttentionScoreResult{
  const calculatedAt=input.calculatedAt??new Date();
  const windowStart=new Date(input.current.timestamp.getTime()-ATTENTION_SCORE_CONFIG.windowDays*86_400_000);
  const history=input.history.filter(item=>item.timestamp<input.current.timestamp&&item.timestamp>=windowStart).slice(0,ATTENTION_SCORE_CONFIG.maxHistory);
  const currentLocal=local(input.current);const currentMinute=currentLocal.hour*60+currentLocal.minute;
  const weighted=history.map(item=>({item,local:local(item),weight:ageWeight(item.timestamp,input.current.timestamp)}));
  const weights=ATTENTION_SCORE_CONFIG.weights;

  const nearest=weighted.map(item=>({value:circularMinutes(currentMinute,item.local.hour*60+item.local.minute),weight:item.weight})).sort((a,b)=>a.value-b.value).slice(0,5);
  const nearestDistance=nearest.length?nearest.reduce((sum,item)=>sum+item.value*item.weight,0)/nearest.reduce((sum,item)=>sum+item.weight,0):360;
  const time=factor(nearestDistance/ATTENTION_SCORE_CONFIG.timeFullDeviationMinutes*100,weights.time,history.length>0,`Afstand tot de vijf meest vergelijkbare tijdstippen: ${Math.round(nearestDistance)} minuten.`);

  const currentWeekend=currentLocal.weekday>=6;const sameDayWeight=weighted.filter(item=>(item.local.weekday>=6)===currentWeekend).reduce((sum,item)=>sum+item.weight,0);const allWeight=weighted.reduce((sum,item)=>sum+item.weight,0);
  const dayPattern=factor(allWeight?100*(1-sameDayWeight/allWeight):0,weights.dayPattern,history.length>=5,currentWeekend?"Vergelijking met het gebruikelijke weekendpatroon.":"Vergelijking met het gebruikelijke weekdagpatroon.");

  const today=currentLocal.toISODate();const currentDayCount=weighted.filter(item=>item.local.toISODate()===today).length+1;
  const oldest=history.reduce((value,item)=>Math.min(value,item.timestamp.getTime()),input.current.timestamp.getTime());
  const baselineDays=Math.max(7,Math.min(30,Math.ceil((input.current.timestamp.getTime()-oldest)/86_400_000)||7));
  const last30=weighted.filter(item=>item.item.timestamp>=new Date(input.current.timestamp.getTime()-30*86_400_000)&&item.local.toISODate()!==today);
  const dailyBaseline=last30.length/baselineDays;
  const frequencyRatio=dailyBaseline>0?currentDayCount/dailyBaseline:1;
  const frequency=factor(frequencyRatio<=ATTENTION_SCORE_CONFIG.frequencyStartRatio?0:(frequencyRatio-ATTENTION_SCORE_CONFIG.frequencyStartRatio)/(ATTENTION_SCORE_CONFIG.frequencyFullRatio-ATTENTION_SCORE_CONFIG.frequencyStartRatio)*100,weights.frequency,history.length>=ATTENTION_SCORE_CONFIG.minimumHistory,`Vandaag ${currentDayCount} passages; historische dagfrequentie circa ${round(dailyBaseline)}.`);

  const historicalNightWeight=weighted.filter(item=>night(item.local.hour)).reduce((sum,item)=>sum+item.weight,0);const nightRate=allWeight?historicalNightWeight/allWeight:0;
  const nightFactor=factor(night(currentLocal.hour)?100*(1-Math.min(1,nightRate/ATTENTION_SCORE_CONFIG.nightBaselineSaturation)):0,weights.night,history.length>=ATTENTION_SCORE_CONFIG.minimumHistory,`Historisch aandeel nachtpassages: ${Math.round(nightRate*100)}%.`);

  const prior=(input.priorAnomalyScores??[]).filter(score=>score>=ATTENTION_SCORE_CONFIG.repeatedAnomalyThreshold).slice(0,10);
  const repeated=factor(prior.length>=2?100:prior.length*25,weights.repeated,true,`${prior.length} eerdere duidelijke afwijking(en) in de korte analyseperiode.`);

  const samePlace=weighted.filter(item=>item.item.cameraId===input.current.cameraId||item.item.location===input.current.location).reduce((sum,item)=>sum+item.weight,0);
  const location=factor(samePlace===0?100:Math.max(0,70-samePlace*10),weights.location,history.length>=5,samePlace===0?"Camera of locatie kwam niet voor in de beschikbare baseline.":"Camera of locatie komt voor in de beschikbare baseline.");

  const currentDirection=normalizeDirection(input.current.direction);const knownDirections=weighted.filter(item=>normalizeDirection(item.item.direction)!=="UNKNOWN");const sameDirection=knownDirections.filter(item=>normalizeDirection(item.item.direction)===currentDirection).reduce((sum,item)=>sum+item.weight,0);
  const direction=factor(currentDirection==="UNKNOWN"?0:sameDirection===0?100:Math.max(0,60-sameDirection*10),weights.direction,currentDirection!=="UNKNOWN"&&knownDirections.length>=ATTENTION_SCORE_CONFIG.minimumDirectionHistory,currentDirection==="UNKNOWN"?"Geen betrouwbare rijrichting ontvangen.":"Vergelijking met bekende historische rijrichtingen.");

  const ordered=[...weighted].sort((a,b)=>a.item.timestamp.getTime()-b.item.timestamp.getTime());const gaps=ordered.slice(1).map((item,index)=>({value:(item.item.timestamp.getTime()-ordered[index]!.item.timestamp.getTime())/60_000,weight:item.weight})).filter(item=>item.value>0);const typicalGap=weightedMedian(gaps);const last=ordered.at(-1);const currentGap=last?(input.current.timestamp.getTime()-last.item.timestamp.getTime())/60_000:undefined;
  let sequenceScore=0;const sequenceAvailable=Boolean(typicalGap&&currentGap&&history.length>=5);
  if(sequenceAvailable&&typicalGap&&currentGap){const ratio=currentGap/typicalGap;sequenceScore=ratio<.2?80:ratio>5?Math.min(100,(ratio-5)*10):0;const lastDirection=normalizeDirection(last?.item.direction);if(currentDirection!=="UNKNOWN"&&lastDirection===currentDirection)sequenceScore=Math.max(sequenceScore,30);}
  const sequence=factor(sequenceScore,weights.sequence,sequenceAvailable,typicalGap&&currentGap?`Tijd sinds vorige passage ${Math.round(currentGap)} minuten; typisch circa ${Math.round(typicalGap)} minuten.`:"Onvoldoende betrouwbare reeksgegevens.");

  const factors={time,dayPattern,frequency,night:nightFactor,repeated,location,direction,sequence};
  const rawScore=Object.values(factors).reduce((sum,item)=>sum+item.contribution,0);
  const confidence=history.length<ATTENTION_SCORE_CONFIG.minimumHistory?"LOW":history.length<ATTENTION_SCORE_CONFIG.highConfidenceHistory?"MEDIUM":"HIGH";
  const score=Math.round(confidence==="LOW"?Math.min(35,rawScore):rawScore);
  const labels:Record<AttentionFactorKey,string>={time:"Het tijdstip wijkt af van het gebruikelijke patroon.",dayPattern:"Het weekdag/weekendpatroon wijkt af.",frequency:`De frequentie is ${round(frequencyRatio)}× de historische dagfrequentie.`,night:`Deze nachtpassage wijkt af van de eigen baseline (${Math.round(nightRate*100)}% nacht).`,repeated:"Meerdere recente afwijkingen versterken het patroon.",location:"Nieuwe of ongebruikelijke camera/locatie in de baseline.",direction:"De rijrichting komt weinig voor in de betrouwbare richtingdata.",sequence:"De volgorde of tijd tussen passages wijkt af."};
  const reasons=(Object.entries(factors) as Array<[AttentionFactorKey,AttentionFactor]>).filter(([,item])=>item.available&&item.score>=ATTENTION_SCORE_CONFIG.reasonThreshold).sort((a,b)=>b[1].contribution-a[1].contribution).slice(0,ATTENTION_SCORE_CONFIG.maxReasons).map(([key])=>labels[key]);
  if(confidence==="LOW")reasons.unshift(`Onvoldoende gegevens: slechts ${history.length} historische passages beschikbaar.`);
  return{score,confidence,status:confidence==="LOW"?"INSUFFICIENT_DATA":"SCORED",factors,reasons:reasons.slice(0,ATTENTION_SCORE_CONFIG.maxReasons),calculatedAt,windowStart,windowEnd:input.current.timestamp};
}
