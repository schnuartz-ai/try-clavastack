export default async function prompt(title: string,message: string,options: any = {}) {
 const value=window.prompt(`${title}\n${message}`,options.defaultValue || '');
 return value ?? undefined;
}
