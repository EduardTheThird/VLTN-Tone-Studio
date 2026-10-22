import type { ScheduledMessage, SchedulerConfig, SchedulerReply } from './midi-scheduler';
export const midiNow=()=>performance.timeOrigin+performance.now();
/** Warm an idle worker before starting audio, with a bounded startup wait. */
export function prepareMidiScheduler() {
  const worker=new Worker(new URL('./midi-scheduler-worker.ts',import.meta.url),{type:'module'});
  let rejectReady:(error:Error)=>void=()=>{};
  const ready=new Promise<void>((resolve,reject)=>{
    rejectReady=reject;
    const timer=setTimeout(()=>{worker.terminate();reject(new Error('MIDI scheduler did not become ready. Reconnect or rearm before playing.'));},2000);
    worker.onmessage=(event:MessageEvent<SchedulerReply>)=>{if(event.data.type==='ready'){clearTimeout(timer);resolve();}};
    worker.onerror=()=>{clearTimeout(timer);worker.terminate();reject(new Error('MIDI scheduling worker could not start.'));};
    rejectReady=error=>{clearTimeout(timer);reject(error);};
  });
  void ready.catch(()=>{});
  return {worker,ready,cancel(){worker.terminate();rejectReady(new Error('MIDI scheduler preparation cancelled.'));}};
}
/** The worker owns cue selection/timers. Window-only MIDI/Bluetooth APIs stay here. */
export function startMidiScheduler(config:SchedulerConfig,onSend:(message:ScheduledMessage)=>void,onFault:(error:string)=>void,prepared?:Worker) {
  const worker=prepared??new Worker(new URL('./midi-scheduler-worker.ts',import.meta.url),{type:'module'});
  let active=true;
  const stop=()=>{active=false;worker.terminate();};
  const fault=(message:string)=>{if(!active)return;stop();onFault(message);};
  worker.onerror=()=>fault('MIDI scheduling worker failed. Cues disarmed; check the pedal state before rearming.');
  worker.onmessage=(event:MessageEvent<SchedulerReply>)=>{
    if(!active)return;
    const reply=event.data;
    if(reply.type==='ready')return;
    if(reply.type==='fault') {fault(reply.error);return;}
    // Reject a delayed bridge batch before sending any part of it.
    if(reply.messages.some(message=>midiNow()-message.due>250)) {fault('MIDI dispatch interrupted: delayed commands discarded and cues disarmed.');return;}
    try {for(const message of reply.messages) {if(!active)return;if(midiNow()-message.due>250){fault('MIDI dispatch interrupted: delayed commands discarded and cues disarmed.');return;}onSend(message);}}
    catch(error) {fault(error instanceof Error?error.message:String(error));}
  };
  worker.postMessage({type:'start',config:{...config,cues:config.cues.filter(c=>c.messages.length).map(c=>({...c,text:''}))}});
  return {stop,sync(position:number){if(active)worker.postMessage({type:'sync',position,at:midiNow()});}};
}
