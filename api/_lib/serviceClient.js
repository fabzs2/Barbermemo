import {createClient} from '@supabase/supabase-js';
export function createServiceClient() {
 const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL;
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
 if(!url||!key)throw new Error('Server database configuration missing.');
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
