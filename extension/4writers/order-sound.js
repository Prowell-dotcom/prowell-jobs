/* Short WAV chime for Chrome MV3 AUDIO_PLAYBACK offscreen document.
 * No external audio URLs, websites, or permissions beyond "offscreen".
 */
'use strict';
function chimeData(kind){
  const sampleRate=22050,seconds=0.64,count=Math.floor(sampleRate*seconds);
  const pcm=new ArrayBuffer(44+count*2),v=new DataView(pcm);
  function ascii(at,s){for(let i=0;i<s.length;i++)v.setUint8(at+i,s.charCodeAt(i));}
  ascii(0,'RIFF');v.setUint32(4,36+count*2,true);ascii(8,'WAVE');
  ascii(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);
  v.setUint16(22,1,true);v.setUint32(24,sampleRate,true);
  v.setUint32(28,sampleRate*2,true);v.setUint16(32,2,true);
  v.setUint16(34,16,true);ascii(36,'data');v.setUint32(40,count*2,true);
  const tones=kind==='processing'?[660,880]:[880,1175];
  for(let i=0;i<count;i++){
    const time=i/sampleRate,second=time>=0.28;
    const t=second?time-0.28:time;
    const freq=tones[second?1:0];
    const attack=Math.min(1,t/0.018);
    const decay=Math.max(0,1-t/0.36);
    const envelope=attack*decay*decay;
    const sample=Math.round(32767*0.34*envelope*
      (0.88*Math.sin(2*Math.PI*freq*t)+0.12*Math.sin(2*Math.PI*freq*2*t)));
    v.setInt16(44+i*2,sample,true);
  }
  const bytes=new Uint8Array(pcm);
  let raw='';
  for(let i=0;i<bytes.length;i++)raw+=String.fromCharCode(bytes[i]);
  return 'data:audio/wav;base64,'+btoa(raw);
}
const chimes={available:chimeData('available'),processing:chimeData('processing')};
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.type!=='PROWELL_PLAY_ORDER_SOUND' ||
     message.target!=='prowell-offscreen-audio')return;
  const kind=message.kind==='processing'?'processing':'available';
  const audio=new Audio(chimes[kind]);
  audio.volume=0.95;
  audio.play().then(()=>respond({ok:true})).catch(error=>{
    console.warn('Prowell notification sound blocked:',String(error?.message||error));
    respond({ok:false});
  });
  return true;
});
