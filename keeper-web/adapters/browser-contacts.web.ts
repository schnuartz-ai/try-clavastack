export async function checkPermission() { return 'denied'; }
export async function requestPermission() { return 'denied'; }
export async function getAll() { return []; }
export async function getAllWithoutPhotos() { return []; }
export async function getContactById() { return null; }
export async function addContact() { throw new Error('Contacts are unavailable in the browser simulator.'); }
export async function openContactForm() { throw new Error('Contacts are unavailable in the browser simulator.'); }
export default { checkPermission, requestPermission, getAll, getAllWithoutPhotos, getContactById, addContact, openContactForm };
