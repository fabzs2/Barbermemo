import {connectDatabase} from './database.mjs';
import {collectDatabaseSnapshot} from '../api/_lib/backupSnapshot.js';
import {verifyDatabaseRestore} from '../api/_lib/restoreCheck.js';
if(process.env.VERCEL_ENV==='production') {
 const db=await connectDatabase();
 try {
  const snapshot=await collectDatabaseSnapshot(db);
  const result=await verifyDatabaseRestore(snapshot);
  console.log(`Production application snapshot restored in isolation: ${result.tables} tables, ${result.rows} rows; original data untouched.`);
 }catch(error){console.error('Backup restoration verification failed:',error.code||error.name,error.message);process.exitCode=1;}
 finally{await db?.end();}
}
