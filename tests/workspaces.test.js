import test from 'node:test';
import assert from 'node:assert/strict';
import { AccessError, accountInput, workspaceInput, authorizeWorkspace, requireSuperAdmin, provisionAccount } from '../api/_lib/workspaces.js';
import { createWorkspaceHandler } from '../api/workspaces.js';
const owner = {id:'owner',role:'dono',ativo:true,barbearia_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
const shop = {id:owner.barbearia_id,owner_id:owner.id,plano:'barbearia',status:'pilot'};
const input = {nome:'Teste',email:'test@example.invalid',password:'Temporary-1234'};
const response = () => ({statusCode:200,setHeader(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}});
function queryResult(data, error = null) {
  const query = { then(resolve, reject){return Promise.resolve({data,error}).then(resolve,reject);} };
  for (const method of ['select','eq','order','maybeSingle','single','insert','update','delete','is']) query[method] = () => query;
  return query;
}

test('owners manage only their active shop; ordinary/inactive users cannot manage', () => {
  authorizeWorkspace(owner,shop);
  for (const [actor,workspace] of [[owner,{...shop,id:'other'}],[owner,{...shop,status:'suspended'}],[{...owner,role:'barbeiro'},shop],[{...owner,ativo:false},shop],[owner,{...shop,owner_id:'other'}]]) assert.throws(()=>authorizeWorkspace(actor,workspace),{status:403});
  assert.throws(()=>requireSuperAdmin(owner),{status:403});
  authorizeWorkspace({role:'super_admin',ativo:true},{...shop,status:'suspended'});
});
test('validation rejects weak credentials and invalid plan limits', () => {
  assert.equal(accountInput({...input,email:' TEST@EXAMPLE.INVALID '}).email,'test@example.invalid');
  for (const values of [{...input,password:'123'}, {...input,email:'bad'}, {...input,nome:'X'}]) assert.throws(()=>accountInput(values),{status:400});
  assert.equal(workspaceInput({workspaceName:'Shop',plano:'individual',limiteBarbeiros:1}).limite_barbeiros,1);
  for (const values of [{plano:'individual',limiteBarbeiros:2},{plano:'barbearia',limiteBarbeiros:0},{plano:'barbearia',limiteBarbeiros:1.5},{plano:'super_admin',limiteBarbeiros:5}]) assert.throws(()=>workspaceInput({workspaceName:'Shop',...values}),{status:400});
});
function provisioningMock({finishError,createError,activated=false}={}) {
  const calls=[];
  const admin={
    rpc:async(name,args)=>{calls.push({name,args});return name==='finish_workspace_account'?{data:null,error:finishError}:{data:'reservation',error:null};},
    auth:{admin:{createUser:async(args)=>{calls.push({name:'create',args});return {data:{user:{id:'new-user'}},error:createError};},deleteUser:async id=>{calls.push({name:'delete',id});return {error:null};}}},
    from:()=>queryResult({ativo:activated,barbearia_id:activated?shop.id:null})
  };
  return {admin,calls};
}
test('provisioning reserves a seat, creates Auth account and finishes without storing password in profile', async()=>{
  const {admin,calls}=provisioningMock();
  const member=await provisionAccount(admin,owner,shop,input,'barbeiro');
  assert.equal(member.role,'barbeiro');
  assert.deepEqual(calls.map(c=>c.name),['reserve_workspace_account','create','finish_workspace_account','cancel_workspace_reservation']);
  assert.deepEqual(calls[1].args.user_metadata,{nome:'Teste'});
  assert.equal(calls[2].args.password,undefined);
});
test('failed finalization removes only a newly created inactive account and releases the seat', async()=>{
  const {admin,calls}=provisioningMock({finishError:{code:'42501',message:'denied'}});
  await assert.rejects(provisionAccount(admin,owner,shop,input,'barbeiro'),{status:403});
  assert.ok(calls.some(c=>c.name==='delete'));
  assert.equal(calls.at(-1).name,'cancel_workspace_reservation');
});
test('ambiguous response never deletes an activated account', async()=>{
  const {admin,calls}=provisioningMock({finishError:{message:'network'},activated:true});
  await assert.rejects(provisionAccount(admin,owner,shop,input,'barbeiro'));
  assert.equal(calls.some(c=>c.name==='delete'),false);
});
test('duplicate email releases reservation and cannot replace existing account', async()=>{
  const {admin,calls}=provisioningMock({createError:{message:'User already registered',status:422}});
  await assert.rejects(provisionAccount(admin,owner,shop,input,'barbeiro'),{status:409});
  assert.equal(calls.some(c=>c.name==='delete'),false);
  assert.equal(calls.at(-1).name,'cancel_workspace_reservation');
});
test('owner cannot provision an owner role',async()=>{
  const {admin,calls}=provisioningMock();
  await assert.rejects(provisionAccount(admin,owner,shop,input,'dono'),{status:403});
  assert.equal(calls.length,0);
});
test('API refuses owner plan changes, other shop ids and titular deactivation',async()=>{
  const handler=createWorkspaceHandler(async()=>({actor:owner,admin:{from:table=>queryResult(table==='barbearias'?shop:{id:owner.id,role:'dono'})}}));
  for(const body of [{action:'update_workspace',workspaceId:shop.id},{action:'create_workspace'},{action:'set_member_active',workspaceId:shop.id,memberId:owner.id,ativo:false}]){
    const res=response();await handler({method:'POST',body},res);assert.equal(res.statusCode,403);
  }
  const foreign=createWorkspaceHandler(async()=>({actor:owner,admin:{from:()=>queryResult({...shop,id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'})}}));
  const res=response();await foreign({method:'POST',body:{action:'add_barber',workspaceId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',...input}},res);assert.equal(res.statusCode,403);
});
test('API derives barber role instead of honoring a forged role in the request',async()=>{
  const {admin,calls}=provisioningMock();admin.from=()=>queryResult(shop);
  const handler=createWorkspaceHandler(async()=>({actor:owner,admin}));
  const res=response();await handler({method:'POST',body:{action:'add_barber',workspaceId:shop.id,...input,role:'super_admin'}},res);
  assert.equal(res.statusCode,201);
  assert.equal(calls[0].args.p_role,'barbeiro');
  assert.equal(res.body.member.password,undefined);
});
test('API rejects expired authentication and unsupported methods',async()=>{
  const handler=createWorkspaceHandler(async()=>{throw new AccessError('expired',401);});
  const res=response();await handler({method:'DELETE'},res);assert.equal(res.statusCode,405);
  const expired=response();await handler({method:'GET'},expired);assert.equal(expired.statusCode,401);
});
