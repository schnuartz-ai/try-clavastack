import React from 'react';
import * as Web from 'react-native-web';
export * from 'react-native-web';
export const BackHandler = {...Web.BackHandler, addEventListener: () => ({remove(){}})};
export const Alert = {alert(title: string, message?: string, buttons: any[] = []) {
 const dialog=document.createElement('dialog');dialog.setAttribute('aria-label',title || 'BlueWallet');
 Object.assign(dialog.style,{background:'#122239',color:'white',border:'1px solid #386598',borderRadius:'12px',maxWidth:'90%',font:'14px system-ui'});
 const heading=document.createElement('h2');heading.textContent=title;const copy=document.createElement('p');copy.textContent=message||'';dialog.append(heading,copy);
 for(const action of buttons.length?buttons:[{text:'OK'}]){const button=document.createElement('button');button.textContent=action.text;button.onclick=()=>{dialog.remove();action.onPress?.();};dialog.append(button);}
 document.body.append(dialog);dialog.showModal();
}};
export const ToastAndroid = {LONG:1,show:(message: string)=>Alert.alert('',message)};
export const Linking = Web.Linking;
(Linking as any).removeAllListeners = ()=>{};

export const TurboModuleRegistry = {get:()=>null,getEnforcing:()=>({addListener(){},removeListeners(){},async getMostRecentUserActivity(){return null;},reloadAllWidgets(){}})};
export function codegenNativeComponent(name:string) {
 if(name!=='SegmentedControl')throw new Error(`Native component unavailable: ${name}`);
 return function SegmentedControl({values=[],selectedIndex,onChange,enabled=true,testID,style}:any){return <Web.View testID={testID} style={[{flexDirection:'row'},style]}>{values.map((value:string,index:number)=><Web.Pressable key={index} accessibilityRole="button" accessibilityState={{selected:index===selectedIndex,disabled:!enabled}} onPress={()=>onChange?.({nativeEvent:{selectedIndex:index}})} style={{flex:1,padding:10,backgroundColor:index===selectedIndex?'#164d8b':'#142237'}}><Web.Text style={{color:'#d4e8ff',textAlign:'center'}}>{value}</Web.Text></Web.Pressable>)}</Web.View>;};
}
