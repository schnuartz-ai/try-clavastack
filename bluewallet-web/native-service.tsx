import React from 'react';
import {View} from 'react-native-web';
const noop=()=>{};
const view=({children,...props}: any)=><View {...props}>{children}</View>;
const constants={GRANTED:'granted',DENIED:'denied',UNAVAILABLE:'unavailable',blocked:'blocked'};
export function namedService(module: string,name: string): any {
 if(name==='RESULTS')return constants;
 if(name==='PERMISSIONS')return {ANDROID:{CAMERA:'camera'},IOS:{CAMERA:'camera'}};
 if(name==='check'||name==='request')return async()=> 'granted'; // Access prompt is handled by the camera's explicit user action.
 if(name==='getLocales')return ()=>[{languageCode:'en',languageTag:'en-US',countryCode:'US',isRTL:false}];
 if(name==='findBestLanguageTag')return ()=>({languageTag:'en',isRTL:false});
 if(name==='getCurrencies')return ()=>['USD'];
 if(name==='getDeviceType')return ()=> 'Handset';
 if(name==='isTablet')return ()=> false;
 if(name==='getFontScaleSync')return ()=>1;
 if(name==='getVersion')return ()=> '8.0.1-browser';
 if(name==='getApplicationName')return ()=> 'BlueWallet Testnet Simulator';
 if(name==='getSystemName')return ()=> 'Browser';
 if(name==='getSystemVersion')return ()=> '1';
 if(name==='getPowerState')return async()=>({lowPowerMode:true});
 if(name==='CaptureProtection')return {prevent:async()=>{},allow:async()=>{},isScreenRecording:async()=>false};
 if(name==='BiometryTypes')return {TouchID:'TouchID',FaceID:'FaceID',Biometrics:'Biometrics'};
 if(name==='useCaptureProtection')return ()=>({isScreenRecording:false,status:'unavailable'});
 if(name==='checkNotifications'||name==='requestNotifications')return async()=>({status:'denied',settings:{}});
 if(/View|ContextMenu|Provider|Lottie/.test(name))return view;
 return noop;
}
export function nativeService(module: string): any {
 if(/context-menu|linear-gradient|lottie/.test(module))return view;
 if(module==='react-native-biometrics')return class {async isSensorAvailable(){return {available:false};} async simplePrompt(){return {success:false};}};
 if(module==='react-native-prompt-android')return (...args:any[])=>{ throw new Error('Use the browser prompt adapter.'); };
 return new Proxy(function(){}, {get(_target,name: string){
  if(name==='then')return undefined;
  if(name==='getString')return async()=>navigator.clipboard.readText();
  if(name==='setString')return (text:string)=>navigator.clipboard.writeText(text);
  if(name==='isAvailable')return async()=>false;
  if(name==='isSensorAvailable')return async()=>({available:false});
  if(name==='addEventListener')return ()=>({remove:noop});
  if(name==='check')return async()=>false;
  if(name==='getDeviceType')return ()=> 'Handset';
  return namedService(module,name);
 }});
}
