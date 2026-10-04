// Direct QR peripheral and actual browser camera. The Dart app owns its
// original normal QR/UR/PSBT parser and all wallet navigation.
let scanCallback;
let scanStatus;
let video;
let cameraStream;
let cameraTimer;
const post = data => parent.postMessage(data, location.origin);
const outputs = new Map();
let lastToken = '';
window.bullQrOutput = (frame, token) => {
  if (typeof frame !== 'string' || !frame || frame.length > 1024*1024) return;
  outputs.set(token,frame); lastToken = token;
  post({type:'bull-qr-output-frame',frame,token});
};
window.bullQrOutputClear = token => {
  outputs.delete(token);
  if (lastToken === token) { lastToken = ''; post({type:'bull-qr-output-clear',token}); }
};
window.bullQrStart = (callback, status) => {
  scanCallback = callback;
  scanStatus = status;
  post({type:'bull-scan-state',active:true});
};
window.bullQrStop = () => {
  scanCallback = undefined;
  scanStatus = undefined;
  clearInterval(cameraTimer); cameraTimer = undefined;
  cameraStream?.getTracks().forEach(track=>track.stop()); cameraStream = undefined;
  if(video) video.srcObject = null;
  post({type:'bull-scan-state',active:false});
};
window.bullQrAttachVideo = element => {
  video = element; video.autoplay = true; video.muted = true; video.playsInline = true;
  Object.assign(video.style,{width:'100%',height:'100%',objectFit:'contain'});
};
window.bullQrCameraStart = async () => {
  if (!video) throw new Error('Camera view is not ready');
  const {default:jsQR} = await import('./qr_decoder.js');
  cameraStream = await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'}}});
  video.srcObject = cameraStream; await video.play();
  const canvas = document.createElement('canvas'); const context = canvas.getContext('2d',{willReadFrequently:true});
  clearInterval(cameraTimer);
  cameraTimer = setInterval(()=>{
    if(!scanCallback || !video.videoWidth) return;
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    context.drawImage(video,0,0); const image = context.getImageData(0,0,canvas.width,canvas.height);
    const result = jsQR(image.data,image.width,image.height,{inversionAttempts:'attemptBoth'});
    if(result?.data) scanCallback(result.data);
  },180);
  return 'Camera active. Point it at a QR code.';
};
addEventListener('message',event=>{
  if(event.origin !== location.origin || event.source !== parent || !event.data) return;
  const data = event.data;
  if(data.type === 'bull-direct-qr-frame' && scanCallback && typeof data.frame === 'string' && data.frame.length <= 1024*1024) scanCallback(data.frame);
  if(data.type === 'bull-direct-qr-status' && scanCallback && typeof data.message === 'string') scanStatus?.(data.message);
  if(data.type === 'bull-runtime-ready-ack') {
    if(lastToken) post({type:'bull-qr-output-frame',frame:outputs.get(lastToken),token:lastToken});
  }
});
