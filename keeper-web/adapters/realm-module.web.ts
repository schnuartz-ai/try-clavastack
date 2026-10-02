export const UpdateMode = { Never: 'never', Modified: 'modified', All: 'all' };
export const BSON = { ObjectId: class ObjectId { constructor(readonly value = `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`) {} toString() { return this.value; } } };
export class ObjectSchema { constructor(public schema: any) {} }
const Realm = { UpdateMode, BSON, ObjectSchema };
if (typeof globalThis !== 'undefined' && !(globalThis as any).Realm) {
  (globalThis as any).Realm = Realm;
}
export default Realm;
