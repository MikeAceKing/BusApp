import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Camera, Check, ImagePlus, Pencil, Trash2, X } from 'lucide-react';
import { api } from '../api';
import { busAppMediaUrl, busAppPublicKey, supabase } from '../supabase';
import type { AvatarReference, BusSpaceRole, Locale, UserProfile } from '../types';
import { BusyButton, ErrorBanner, InitialAvatar, LanguageSwitch, createT, type T } from './Shared';

export type AvatarKind = 'adult'|'child'|'bus';
const ids: Record<AvatarKind,string[]> = {
  adult: Array.from({length:8},(_,index)=>`adult-${String(index+1).padStart(2,'0')}`),
  child: Array.from({length:24},(_,index)=>`child-${String(index+1).padStart(2,'0')}`),
  bus: ['bus-yellow-city','bus-yellow-small','bus-blue-mini','bus-green-mini','bus-orange-coach','bus-electric'],
};
const emptyAvatar: AvatarReference = { source:'BUILT_IN', builtInAvatarId:null, assetId:null, version:1, photoUrl:null };

export function roleLabel(t:T, role?:BusSpaceRole|'PARENT'|null):string {
  if(role==='ATTENDANT')return t('roleAttendant');
  if(role==='PARENT')return t('roleParent');
  if(role==='OWNER')return t('roleOwner');
  return t('roleDriver');
}

export function AvatarDisplay({kind,avatar,name,size='normal'}:{kind:AvatarKind;avatar?:AvatarReference|null;name:string;size?:'normal'|'large'}) {
  const [photoFailed,setPhotoFailed]=useState(false);
  useEffect(()=>setPhotoFailed(false),[avatar?.photoUrl]);
  if(avatar?.photoUrl&&!photoFailed)return <img className={`canonical-avatar canonical-avatar--${kind} canonical-avatar--${size}`} src={avatar.photoUrl} alt={name} onError={()=>setPhotoFailed(true)} />;
  if(avatar?.builtInAvatarId)return <img className={`canonical-avatar canonical-avatar--${kind} canonical-avatar--${size}`} src={`/avatars/${avatar.builtInAvatarId}.svg`} alt={name} />;
  return <InitialAvatar name={name} avatar="initials-blue" />;
}

async function croppedFile(file:File,kind:AvatarKind,zoom:number):Promise<File>{
  const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});
  const aspect=kind==='bus'?4/3:1;
  const sourceAspect=bitmap.width/bitmap.height;
  let sw=sourceAspect>aspect?bitmap.height*aspect:bitmap.width;
  let sh=sourceAspect>aspect?bitmap.height:bitmap.width/aspect;
  sw/=zoom;sh/=zoom;
  const sx=(bitmap.width-sw)/2,sy=(bitmap.height-sh)/2;
  const width=kind==='bus'?1200:900,height=Math.round(width/aspect);
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d');if(!context)throw new Error('IMAGE_PREVIEW_FAILED');
  context.drawImage(bitmap,sx,sy,sw,sh,0,0,width,height);bitmap.close();
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob((value)=>value?resolve(value):reject(new Error('IMAGE_PREVIEW_FAILED')),'image/webp',.9));
  return new File([blob],'busapp-avatar.webp',{type:'image/webp'});
}

async function uploadPhoto(path:string,file:File):Promise<void>{
  const session=await supabase.auth.getSession();const token=session.data.session?.access_token;if(!token)throw new Error('Authentication required.');
  const form=new FormData();form.set('file',file);
  const response=await fetch(`${busAppMediaUrl}${path}`,{method:'POST',headers:{authorization:`Bearer ${token}`,apikey:busAppPublicKey},body:form});
  const payload=await response.json().catch(()=>({})) as Record<string,unknown>;if(!response.ok)throw new Error(String(payload.message||'Photo upload failed.'));
}

// Built-in avatar and photo choices are discrete, server-versioned decisions: each one is
// applied on selection under its own optimistic-concurrency check.
export function AvatarEditor({kind,avatar,name,locale,patchPath,uploadPath,onChanged,editable=true,failureKey='avatarSaveFailed'}:{kind:AvatarKind;avatar?:AvatarReference|null;name:string;locale:Locale;patchPath:string;uploadPath:string;onChanged:()=>Promise<void>;editable?:boolean;failureKey?:'avatarSaveFailed'|'busSaveFailed'|'profileSaveFailed'}){
  const reference=avatar||emptyAvatar;
  const t=createT(locale);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [file,setFile]=useState<File|null>(null);const [preview,setPreview]=useState('');const [zoom,setZoom]=useState(1);
  useEffect(()=>{if(!file){setPreview('');return;}const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url);},[file]);
  async function choose(id:string){setBusy(true);setError('');try{await api(patchPath,{method:'PATCH',body:{builtInAvatarId:id,expectedVersion:reference.version}});await onChanged();}catch{setError(t(failureKey));}finally{setBusy(false);}}
  async function savePhoto(){if(!file)return;setBusy(true);setError('');try{await uploadPhoto(uploadPath,await croppedFile(file,kind,zoom));setFile(null);setZoom(1);await onChanged();}catch{setError(t(failureKey));}finally{setBusy(false);}}
  if(!editable)return <p className="profile-help">{t('ownerOnly')}</p>;
  return <section className="avatar-editor">
    <ErrorBanner message={error}/><h3>{kind==='bus'?t('chooseBusAvatar'):kind==='child'?t('choosePassengerAvatar'):t('chooseProfileAvatar')}</h3>
    <div className={`avatar-catalog avatar-catalog--${kind}`} role="list" aria-label={t('builtInAvatars')}>{ids[kind].map((id)=><button type="button" role="listitem" key={id} disabled={busy} aria-label={id} aria-pressed={reference.builtInAvatarId===id&&!reference.photoUrl} onClick={()=>void choose(id)}><img src={`/avatars/${id}.svg`} alt=""/>{reference.builtInAvatarId===id&&!reference.photoUrl&&<Check aria-hidden="true"/>}</button>)}</div>
    {!file?<div className="photo-actions">
      <label className="secondary-button button-with-icon photo-picker"><ImagePlus aria-hidden="true"/>{reference.photoUrl?t('changePhoto'):t('uploadPhoto')}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event:ChangeEvent<HTMLInputElement>)=>setFile(event.target.files?.[0]||null)}/></label>
      {reference.photoUrl&&<BusyButton type="button" busy={busy} className="danger-link button-with-icon" onClick={()=>void choose(reference.builtInAvatarId||ids[kind][0])}><Trash2 aria-hidden="true"/>{t('removePhoto')}</BusyButton>}
    </div>:<div className="photo-cropper">
      <strong>{t('photoPreview')}</strong><div className={`photo-cropper__frame photo-cropper__frame--${kind}`}><img src={preview} alt="" style={{transform:`scale(${zoom})`}}/></div>
      <label>{t('zoom')}<input type="range" min="1" max="2.5" step="0.05" value={zoom} onChange={(event)=>setZoom(Number(event.target.value))}/></label><small>{t('photoHint')}</small>
      <div><button type="button" className="secondary-button button-with-icon" onClick={()=>setFile(null)}><X aria-hidden="true"/>{t('cancelPhoto')}</button><BusyButton type="button" busy={busy} className="primary-button button-with-icon" onClick={()=>void savePhoto()}><Camera aria-hidden="true"/>{t('save')}</BusyButton></div>
    </div>}
  </section>;
}

// The personal profile is a person, never the bus. `fallbackName` is only used before the
// server has issued a profile and must never be seeded from a Bus Space name.
export function UserProfileEditor({profile,locale,onLocale,onChanged,role,fallbackName='BusApp'}:{profile?:UserProfile|null;locale:Locale;onLocale:(locale:Locale)=>void;onChanged:()=>Promise<void>;role?:BusSpaceRole|'PARENT'|null;fallbackName?:string}){
  const safeProfile=profile||{user_id:'',display_name:fallbackName,language:locale,avatar_version:1,avatar:emptyAvatar};
  const t=createT(locale);const [editing,setEditing]=useState(false);const [name,setName]=useState(safeProfile.display_name);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  useEffect(()=>setName(safeProfile.display_name),[safeProfile.display_name]);
  async function save(event:FormEvent){
    event.preventDefault();
    if(!name.trim()){setError(t('nameRequired'));return;}
    setBusy(true);setError('');
    try{await api('/profile',{method:'PATCH',body:{displayName:name.trim(),expectedVersion:safeProfile.avatar.version}});await onChanged();setEditing(false);}
    catch{setError(t('profileSaveFailed'));}finally{setBusy(false);}
  }
  async function changeLanguage(value:Locale){const previous=locale;onLocale(value);setError('');if(!profile)return;try{await api('/profile',{method:'PATCH',body:{language:value,expectedVersion:safeProfile.avatar.version}});await onChanged();}catch{onLocale(previous);setError(t('profileSaveFailed'));}}
  return <section className="profile-editor-card">
    <div className="profile-editor-card__head">
      <AvatarDisplay kind="adult" avatar={safeProfile.avatar} name={safeProfile.display_name} size="large"/>
      <div><h2>{safeProfile.display_name}</h2><small>{roleLabel(t,role)}</small></div>
    </div>
    <ErrorBanner message={error}/>
    {profile&&!editing&&<button className="secondary-button button-with-icon edit-affordance" onClick={()=>{setName(safeProfile.display_name);setEditing(true);}}><Pencil aria-hidden="true"/>{t('editProfile')}</button>}
    {profile&&editing&&<div className="profile-edit-panel">
      <form className="profile-name-form" onSubmit={save}>
        <label>{t('displayName')}<input required autoFocus maxLength={50} value={name} onChange={(event)=>setName(event.target.value)}/></label>
        <div className="edit-actions"><button type="button" className="secondary-button" onClick={()=>{setName(safeProfile.display_name);setEditing(false);setError('');}}>{t('cancelEdit')}</button><BusyButton busy={busy} className="primary-button">{t('save')}</BusyButton></div>
      </form>
      <AvatarEditor kind="adult" avatar={safeProfile.avatar} name={safeProfile.display_name} locale={locale} patchPath="/profile" uploadPath="/profile" onChanged={onChanged} failureKey="profileSaveFailed"/>
    </div>}
    <div className="profile-language"><span><strong>{t('interfaceLanguage')}</strong><small>{locale==='fr'?t('languageFrench'):t('languageDutch')}</small></span><LanguageSwitch locale={locale} onChange={(value)=>void changeLanguage(value)}/></div>
  </section>;
}

// The bus is its own identity: name, avatar and photo, separate from any person.
export function BusProfileCard({busId,spaceId,name,avatar,subtitle,locale,onChanged,editable}:{busId:string;spaceId:string;name:string;avatar?:AvatarReference|null;subtitle:string;locale:Locale;onChanged:()=>Promise<void>;editable:boolean}){
  const t=createT(locale);const reference=avatar||emptyAvatar;
  const [editing,setEditing]=useState(false);const [busName,setBusName]=useState(name);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  useEffect(()=>setBusName(name),[name]);
  async function save(event:FormEvent){
    event.preventDefault();
    if(!busName.trim()){setError(t('nameRequired'));return;}
    setBusy(true);setError('');
    try{await api(`/spaces/${spaceId}/buses/${busId}/profile`,{method:'PATCH',body:{name:busName.trim(),expectedVersion:reference.version}});await onChanged();setEditing(false);}
    catch{setError(t('busSaveFailed'));}finally{setBusy(false);}
  }
  return <section className="profile-editor-card bus-profile-card">
    <div className="profile-editor-card__head">
      <AvatarDisplay kind="bus" avatar={reference} name={name} size="large"/>
      <div><h2>{name}</h2><small>{subtitle}</small></div>
    </div>
    <ErrorBanner message={error}/>
    {!editable&&<p className="profile-help">{t('ownerOnly')}</p>}
    {editable&&!editing&&<button className="secondary-button button-with-icon edit-affordance" onClick={()=>{setBusName(name);setEditing(true);}}><Pencil aria-hidden="true"/>{t('editBus')}</button>}
    {editable&&editing&&<div className="profile-edit-panel">
      <form className="profile-name-form" onSubmit={save}>
        <label>{t('busName')}<input required autoFocus minLength={2} maxLength={80} value={busName} onChange={(event)=>setBusName(event.target.value)}/></label>
        <div className="edit-actions"><button type="button" className="secondary-button" onClick={()=>{setBusName(name);setEditing(false);setError('');}}>{t('cancelEdit')}</button><BusyButton busy={busy} className="primary-button">{t('save')}</BusyButton></div>
      </form>
      <AvatarEditor kind="bus" avatar={reference} name={name} locale={locale} patchPath={`/spaces/${spaceId}/buses/${busId}/profile`} uploadPath={`/spaces/${spaceId}/buses/${busId}`} onChanged={onChanged} failureKey="busSaveFailed"/>
    </div>}
  </section>;
}
