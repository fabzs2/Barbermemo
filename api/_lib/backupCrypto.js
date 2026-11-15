import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
const MAGIC=Buffer.from('BMBK1');
function encryptionKey(value=process.env.BACKUP_ENCRYPTION_KEY){if(!/^[a-f0-9]{64}$/i.test(value||''))throw new Error('Backup encryption key must be configured.');return Buffer.from(value,'hex');}
export function encryptBackup(snapshot,key) {
 const plain=Buffer.from(JSON.stringify(snapshot));if(plain.length>64*1024*1024)throw new Error('Backup exceeds configured safe size.');
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(key),iv);cipher.setAAD(MAGIC);
 const body=Buffer.concat([cipher.update(gzipSync(plain)),cipher.final()]);
 return Buffer.concat([MAGIC,iv,cipher.getAuthTag(),body]);
}
export function decryptBackup(buffer,key) {
 const value=Buffer.from(buffer);if(value.length<34||!value.subarray(0,5).equals(MAGIC))throw new Error('Unsupported backup format.');
 const decipher=createDecipheriv('aes-256-gcm',encryptionKey(key),value.subarray(5,17));decipher.setAAD(MAGIC);decipher.setAuthTag(value.subarray(17,33));
 const plain=gunzipSync(Buffer.concat([decipher.update(value.subarray(33)),decipher.final()]),{maxOutputLength:64*1024*1024});
 const snapshot=JSON.parse(plain);if(snapshot.format!=='barbermemo-application-backup-v1')throw new Error('Unsupported backup payload.');return snapshot;
}
