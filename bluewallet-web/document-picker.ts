import {fileClient,putFile,readFile} from './files';
export const types={allFiles:'*/*',plainText:'text/plain',images:'image/*'};
export const errorCodes={OPERATION_CANCELED:'OPERATION_CANCELED'};
export async function pick(options:any){const files=await (await fileClient()).pick(options);return Promise.all(files.map(async(file:File)=>({name:file.name,size:file.size,type:file.type,hasRequestedType:true,uri:putFile(file.name,new Uint8Array(await file.arrayBuffer()))})));}
export async function keepLocalCopy({files}:any){return files.map((file:any)=>({status:'success',localUri:file.uri,sourceUri:file.uri}));}
export async function saveDocuments({sourceUris,fileName,mimeType}:any){const bytes=Uint8Array.from(atob(await readFile(decodeURI(sourceUris[0]),'base64')),char=>char.charCodeAt(0));await (await fileClient()).save({name:fileName,bytes,type:mimeType});return [{uri:sourceUris[0],error:null}];}
