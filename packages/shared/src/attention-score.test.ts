import { describe, expect, it } from "vitest";
import { calculateAttentionScore, type AttentionPassage } from "./attention-score.js";
import { localToUtc } from "./presentation.js";

const zone="Europe/Amsterdam";
const passage=(date:string,time:string,extra:Partial<AttentionPassage>={}):AttentionPassage=>({timestamp:localToUtc(date,time,zone),timezone:zone,cameraId:"camera-a",location:"Uddel Noord",direction:"INCOMING",...extra});
const daysBefore=(date:string,count:number)=>{const end=new Date(`${date}T12:00:00Z`);return Array.from({length:count},(_,index)=>new Date(end.getTime()-(index+1)*86_400_000).toISOString().slice(0,10));};
const regular=(date="2026-09-18",count=30)=>daysBefore(date,count).flatMap(day=>[passage(day,"07:00",{direction:"OUTGOING"}),passage(day,"17:00",{direction:"INCOMING"})]);

describe("uitlegbare aandachtsscore",()=>{
  it("A: houdt een gebruikelijke passage om 07:05 zeer laag",()=>{
    const result=calculateAttentionScore({current:passage("2026-09-18","07:05",{direction:"OUTGOING"}),history:regular()});
    expect(result.confidence).toBe("HIGH");expect(result.score).toBeLessThan(15);expect(result.factors.time.score).toBeLessThan(5);
  });

  it("B: verhoogt de score voor een sterk afwijkend tijdstip",()=>{
    const result=calculateAttentionScore({current:passage("2026-09-18","02:15"),history:regular()});
    expect(result.score).toBeGreaterThan(25);expect(result.factors.time.score).toBeGreaterThan(60);expect(result.factors.night.score).toBeGreaterThan(80);
  });

  it("C: weegt herhaalde afwijkingen zwaarder dan een losse afwijking",()=>{
    const baseline=regular("2026-09-16");
    const firstPassage=passage("2026-09-16","00:15");
    const first=calculateAttentionScore({current:firstPassage,history:baseline});
    const secondPassage=passage("2026-09-17","01:30");
    const second=calculateAttentionScore({current:secondPassage,history:[...baseline,firstPassage],priorAnomalyScores:[first.score]});
    const repeated=calculateAttentionScore({current:passage("2026-09-18","02:45"),history:[...baseline,firstPassage,secondPassage],priorAnomalyScores:[first.score,second.score]});
    expect(repeated.score).toBeGreaterThan(first.score);expect(repeated.factors.repeated.score).toBeGreaterThan(first.factors.repeated.score);
  });

  it("D: straft een structurele nachtdienst niet automatisch zwaar",()=>{
    const history=daysBefore("2026-09-18",14).flatMap(day=>[passage(day,"22:00",{direction:"OUTGOING"}),passage(day,"02:00",{direction:"INCOMING"})]);
    const result=calculateAttentionScore({current:passage("2026-09-18","02:05"),history});
    expect(result.factors.time.score).toBeLessThan(5);expect(result.factors.night.score).toBeLessThan(40);expect(result.score).toBeLessThan(20);
  });

  it("E: signaleert een plots veel hogere frequentie",()=>{
    const current=passage("2026-09-18","16:00");const burst=["08:00","09:00","10:00","11:00","12:00","13:00"].map(time=>passage("2026-09-18",time));
    const result=calculateAttentionScore({current,history:[...regular(),...burst]});
    expect(result.factors.frequency.score).toBeGreaterThan(50);
  });

  it("F: signaleert een nieuwe camera en locatie",()=>{
    const result=calculateAttentionScore({current:passage("2026-09-18","07:05",{cameraId:"camera-new",location:"Nieuwe locatie"}),history:regular()});
    expect(result.factors.location.score).toBe(100);expect(result.reasons.join(" ")).toContain("locatie");
  });

  it("G: markeert twee historische passages als onvoldoende gegevens",()=>{
    const result=calculateAttentionScore({current:passage("2026-09-18","02:15"),history:regular().slice(0,2)});
    expect(result.confidence).toBe("LOW");expect(result.status).toBe("INSUFFICIENT_DATA");expect(result.score).toBeLessThanOrEqual(35);
  });

  it("H: verhoogt de richtingsfactor niet bij UNKNOWN",()=>{
    const result=calculateAttentionScore({current:passage("2026-09-18","07:05",{direction:"UNKNOWN"}),history:regular()});
    expect(result.factors.direction.available).toBe(false);expect(result.factors.direction.score).toBe(0);
  });

  it("I: vergelijkt lokale kloktijd correct over zomer- en wintertijd",()=>{
    const history=[passage("2026-03-28","07:00"),passage("2026-03-29","07:00"),passage("2026-03-30","07:00"),passage("2026-10-24","07:00"),passage("2026-10-25","07:00"),passage("2026-10-26","07:00")];
    const result=calculateAttentionScore({current:passage("2026-10-27","07:05"),history});
    expect(result.factors.time.score).toBeLessThan(5);
  });
});
