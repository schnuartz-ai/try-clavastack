import { createCompanionMedia } from './companion-media.js';

/** Shared device/media/QR transport. Upstream applications own all parsing. */
export function createCompanionWorkbench({id,label,storageKey,description}) {
  const specter = document.querySelector('#specter-simulator');
  const companion = document.querySelector(`#${id}-runtime`);
  const badge = document.querySelector('#specter-badge');
  const status = document.querySelector(`#${id}-status`);
  const qrStatus = document.querySelector('#specter-qr-status');
  const sendButton = document.querySelector(`#send-${id}-qr`);
  const cameraButton = document.querySelector('#use-specter-camera');
  const post = data => companion.contentWindow?.postMessage({...data,type:`${id}-${data.type}`},location.origin);
  const postDiy = data => specter.contentWindow?.postMessage(data,location.origin);
  let diyReady = false, companionReady = false, scannerActive = false, companionScanning = false;
  const media = createCompanionMedia({
    container:document.querySelector('#companion-media'),companionLabel:label,storageKey,
    isDiyRunning:()=>diyReady,isCompanionReady:()=>companionReady,
    sendDiyMessage:postDiy,
    getTargetZone:target=>target==='desktop'?companion.closest('.phone'):specter.closest('.device-frame'),
    onState:state=>companion.contentWindow?.postMessage({type:'specter-media-state',...state},location.origin),
  });
  const mediaReady = media.init();
  mediaReady.catch(error=>{document.querySelector('#media-status').textContent=`Media error: ${error.message}`;});
  const cable = document.querySelector('#cable-toggle');
  const cableStatus = document.querySelector('#cable-status');
  const note = document.createElement('p'); note.className='drop-help';
  note.textContent=`${label}’s Specter integration uses QR. USB signing is not supported by this upstream integration.`;
  cableStatus.after(note);
  const updateCable = ()=>{
    const text = cable.checked ? `Cable is on. ${label}’s Specter integration uses QR; USB transport is unavailable.` : 'Cable is off.';
    cableStatus.textContent=text;cable.title=text;cable.setAttribute('aria-label',text);
    document.querySelector('.cable-group').classList.toggle('armed',cable.checked);
  };
  cable.addEventListener('change',updateCable);updateCable();
  let sendTimer, receiveTimer, sendIndex=0, receiveIndex=0;
  let scannerChangedAt=0;
  const makeBuffer = ()=>({frames:[],group:'',token:'',first:'',at:0});
  const outgoing=makeBuffer(), incoming=makeBuffer();
  function group(frame) {
    const ur=frame.match(/^ur:([^/]+)/i);
    return ur?`ur:${ur[1].toLowerCase()}`:frame.startsWith('B$')?'bbqr':/^p\d+of\d+/i.test(frame)?'p-of-n':'single';
  }
  function remember(buffer,frame,token='') {
    if(typeof frame!=='string'||!frame.trim()||frame==='Text')return;
    const value=frame.trim(), kind=group(value), now=Date.now();
    if(token && token!==buffer.token)clear(buffer);
    if(token)buffer.token=token;
    if(kind==='single')buffer.frames=[value];
    else {
      if(now-buffer.at>2400||(buffer.group&&kind!==buffer.group)){buffer.frames=[];buffer.first='';}
      if(/^ur:[^/]+\/1(?:-|\/)/i.test(value)||/^p1of/i.test(value)){
        if(buffer.first&&buffer.first!==value)buffer.frames=[];
        buffer.first=value;
      }
      // Upstream animated QR screens repeat their first fragment. Keep the
      // complete sequence across those cycles so a receiver cannot miss a part.
      if(!buffer.frames.includes(value))buffer.frames.push(value);
      if(buffer.frames.length>200)buffer.frames.splice(0,buffer.frames.length-200);
    }
    buffer.group=kind;buffer.at=now;
  }
  function clear(buffer,token='') {
    if(token&&buffer.token&&token!==buffer.token)return;
    buffer.frames=[];buffer.group='';buffer.token='';buffer.first='';buffer.at=0;
  }
  function sendNext() {
    if(companionScanning&&incoming.frames.length)post({type:'direct-qr-frame',frame:incoming.frames[receiveIndex++%incoming.frames.length]});
  }
  function updateSend() {
    sendButton.disabled=!scannerActive||!outgoing.frames.length;
    sendButton.title=!scannerActive?'Open a QR scanner on Specter DIY first.':!outgoing.frames.length?`Open a ${label} screen that is displaying a QR code first.`:`Send ${label} QR frames to Specter DIY’s normal camera QR parser.`;
    if(cameraButton){
      cameraButton.disabled=!scannerActive;
      cameraButton.title=scannerActive?'Open the Specter camera to scan a SeedQR or another external QR code.':'Open a QR scanner on Specter DIY first.';
    }
    qrStatus.textContent=!scannerActive?`Open the Specter QR scanner to receive frames from ${label}.`:outgoing.frames.length?`Specter scanner is active. Send the currently displayed ${label} QR.`:`Specter scanner is active. Open a QR screen in ${label}.`;
  }
  function sendQr() {
    if(!scannerActive||!outgoing.frames.length){updateSend();return;}
    postDiy({type:'simulator-qr-source',source:'desktop'});
    clearInterval(sendTimer);sendIndex=0;let count=0;
    const send=()=>{
      // Specter's real UART scanner briefly stops/restarts between UR parts.
      // Pause during that interval; stop when the scanner stays closed.
      if(!scannerActive){if(Date.now()-scannerChangedAt>2500){clearInterval(sendTimer);sendTimer=undefined;}return;}
      if(!outgoing.frames.length){clearInterval(sendTimer);sendTimer=undefined;return;}
      postDiy({type:'simulator-inject-qr',frame:outgoing.frames[sendIndex++%outgoing.frames.length]});count++;
      qrStatus.textContent=outgoing.frames.length>1?`Feeding ${label}’s animated QR sequence to Specter (${count} frames).`:`Feeding ${label}’s visible QR frame to Specter (${count}).`;
    };
    send();sendTimer=setInterval(send,550);
  }
  function useSpecterCamera() {
    if(!scannerActive)return;
    qrStatus.textContent='Opening the Specter camera. Allow camera access in the browser prompt.';
    postDiy({type:'simulator-qr-source',source:'camera'});
  }
  addEventListener('message',event=>{
    if(event.origin!==location.origin||!event.data||typeof event.data!=='object')return;
    const data=event.data;
    if(event.source===specter.contentWindow){
      if(['child-awaiting-peripherals','peripherals-snapshot','peripheral-state'].includes(data.type)){mediaReady.then(()=>media.handleDiyMessage(data));return;}
      if(data.type==='simulator-running'){diyReady=true;media.render();badge.textContent='Running';badge.classList.add('online');}
      else if(data.type==='simulator-scanner-state'){scannerActive=Boolean(data.active);scannerChangedAt=Date.now();updateSend();}
      else if(data.type==='simulator-qr-source-state'){
        qrStatus.textContent=data.source==='camera'
          ?'Specter camera selected. Point it at the SeedQR; if blocked, tap Enable camera on the Specter screen.'
          :data.source==='desktop'
            ?`Scanning ${label} QR frames through Specter.`
            :cameraButton
              ?'Choose a source: scan a SeedQR with the camera, or send a QR from Bull Bitcoin.'
              :`Specter scanner is active. Open a QR screen in ${label}.`;
      }
      else if(data.type==='simulator-qr-output'){remember(incoming,data.frame,data.token||'');sendNext();}
      else if(data.type==='simulator-qr-output-clear')clear(incoming,data.token||'');
      else if(data.type==='simulator-qr-result')qrStatus.textContent=data.ok?'QR frame reached Specter DIY’s real scanner input.':data.message;
    } else if(event.source===companion.contentWindow){
      if(data.type.startsWith('specter-media-')){mediaReady.then(()=>media.handleCompanionMessage(data,reply=>companion.contentWindow?.postMessage(reply,location.origin)));return;}
      if(data.type===`${id}-runtime-ready`){mediaReady.then(()=>media.notify());if(!companionReady)status.textContent=`${label}’s upstream app is starting.`;post({type:'runtime-ready-ack'});}
      else if(data.type===`${id}-app-mounted`){companionReady=true;media.render();status.textContent=description||`${label} is running in this browser.`;}
      else if(data.type===`${id}-scan-state`){
        companionScanning=Boolean(data.active);receiveIndex=0;clearInterval(receiveTimer);receiveTimer=undefined;
        if(companionScanning){
          if(!incoming.frames.length)post({type:'direct-qr-status',message:'No QR is currently visible on Specter DIY. Open its QR screen, then try again.'});
          else{sendNext();receiveTimer=setInterval(sendNext,320);}
        }
      } else if(data.type===`${id}-qr-output-frame`){remember(outgoing,data.frame,data.token||'');updateSend();}
      else if(data.type===`${id}-qr-output-clear`){clear(outgoing,data.token||'');sendIndex=0;updateSend();}
    }
  });
  specter.addEventListener('load',()=>{diyReady=false;media.render();postDiy({type:'gallery-parent-ready'});badge.textContent='Starting';});
  companion.addEventListener('load',()=>{companionReady=false;companionScanning=false;clear(outgoing);clearInterval(receiveTimer);receiveTimer=undefined;status.textContent=`Loading the ${label} app…`;media.render();updateSend();});
  sendButton.addEventListener('click',sendQr);
  cameraButton?.addEventListener('click',useSpecterCamera);
  document.querySelector('#specter-restart').addEventListener('click',()=>{diyReady=false;media.render();postDiy({type:'runtime-restart'});clear(incoming);});
  document.querySelector('#specter-reset').addEventListener('click',()=>{diyReady=false;media.render();postDiy({type:'simulator-factory-reset'});clear(incoming);});
  document.querySelector(`#${id}-reset`).addEventListener('click',()=>{companionReady=false;media.render();clear(outgoing);companionScanning=false;clearInterval(receiveTimer);post({type:'reset'});status.textContent=`Resetting ${label}’s disposable browser-session data…`;});
  setInterval(updateSend,1000);setTimeout(()=>postDiy({type:'gallery-parent-ready'}),50);
  return {media};
}
