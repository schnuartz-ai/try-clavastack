const databases = new Map<string, Map<string, any[]>>();
class Results extends Array<any> {
 filtered(query: string, ...args: any[]) {
  const match=query.match(/(\w+)\s*=\s*['"]([^'"]+)['"]/);
  return Results.from(match ? this.filter(row => row[match[1]] === match[2]) : this);
 }
 addListener() {} removeListener() {} removeAllListeners() {}
}
export default class Realm {
 static UpdateMode = {Modified:'modified'};
 static defaultPath = '/blue-testnet/cache';
 static async open(options: any) { return new Realm(options); }
 static deleteFile({path}: any) { databases.delete(path); }
 static exists({path}: any) { return databases.has(path); }
 db: Map<string,any[]>; isClosed=false;
 constructor(options: any) { this.db=databases.get(options.path) || new Map(); databases.set(options.path,this.db); }
 objects(name: string) { const rows=this.db.get(name) || []; const result=Results.from(rows); return result; }
 objectForPrimaryKey(name: string,key: any) { return this.db.get(name)?.find(row => row.key === key || row.walletid === key); }
 write(action: ()=>void) { return action(); }
 create(name: string,row: any) { const rows=this.db.get(name) || []; const existing=rows.find(item=>row.key!==undefined && item.key===row.key); if(existing) Object.assign(existing,row);else rows.push({...row});this.db.set(name,rows); return row; }
 delete(rows: any[]) { for (const [key,items] of this.db) this.db.set(key,items.filter(item=>!rows.includes(item))); }
 close() { this.isClosed=true; }
}
