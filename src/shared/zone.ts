import { ZONE_PHASES } from './constants';
import { ZoneState } from './types';

export function zoneAtTime(elapsed:number): ZoneState {
  let remaining=Math.max(0,elapsed), index=0;
  while(index<ZONE_PHASES.length-1 && remaining>=ZONE_PHASES[index].durationSeconds){remaining-=ZONE_PHASES[index].durationSeconds;index++;}
  const phase=ZONE_PHASES[index], target=ZONE_PHASES[index+1]?.radius ?? 0;
  const timer=Math.max(0,phase.durationSeconds-remaining);
  const shrink=Math.max(0,Math.min(1,remaining/(phase.durationSeconds/2)-1));
  return {currentCenter:{x:0,y:0,z:0},targetCenter:{x:0,y:0,z:0},currentRadius:phase.radius+(target-phase.radius)*shrink,targetRadius:target,phase:index+1,phaseDuration:phase.durationSeconds,phaseTimer:timer,isShrinking:shrink>0&&shrink<1,dps:phase.dps};
}

export function zoneStageSeconds(zone:ZoneState):number {
  return Math.max(0,zone.phaseTimer>zone.phaseDuration/2?zone.phaseTimer-zone.phaseDuration/2:zone.phaseTimer);
}
