import React, {useCallback,useEffect,useRef,useState} from 'react';
import {LogOut,X} from 'lucide-react';
import {Context,Loading,Notice,Row} from './components/shared';
import {Business,Operator} from './components/Backoffice';
import {Login,Reset} from './components/Account';
import Link,{navigate,usePathname,portalOrigin} from './navigation';
import {panelRoute} from './portal-routes.mjs';
export function PanelApp({kind}:{kind:'owner'|'admin'}) {
 const path=usePathname(),prefix=kind==='owner'?'company':'operator';
 const [user,setUser]=useState<Row|null>(null),[ready,setReady]=useState(false),[notice,setNotice]=useState<{text:string,error?:boolean}|null>(null);
 const csrf=useRef('');
 const api=useCallback(async(p:string,method='GET',body?:any,key?:string)=>{
  const headers:Record<string,string>={};
  if(body && !(body instanceof FormData))headers['Content-Type']='application/json';
  if(method!=='GET')headers['x-csrf-token']=csrf.current;
  if(key)headers['Idempotency-Key']=key;
  const res=await fetch('/api/v1'+p,{method,headers,credentials:'same-origin',cache:'no-store',body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body)});
  const data=await res.json();if(!res.ok)throw Error(data.message||'Nie udało się zapisać danych.');return data;
 },[]);
 const session=useCallback(async()=>{const s=await api('/auth/me');csrf.current=s.csrf||'';setUser(s.user);return s.user;},[api]);
 const act=useCallback(async(fn:()=>Promise<any>,message?:string)=>{try{const result=await fn();if(message)setNotice({text:message});return result;}catch(e:any){setNotice({text:e.message,error:true});}},[]);
 useEffect(()=>{session().catch(e=>setNotice({text:e.message,error:true})).finally(()=>setReady(true));},[session]);
 useEffect(()=>{setNotice(null);window.scrollTo(0,0);},[path]);
 const route=panelRoute(path,kind);
 const login=/^\/login(?:\/|$)/.test(path)||!user;
 const next='/'+prefix;
 const authReturnTo=path===next||path.startsWith(next+'/')?path+window.location.search+window.location.hash:next;
 const context={api,user,setUser,ready,session,act,authAudience:kind,authReturnTo,notify:(text:string)=>setNotice({text}),navigate:(p:string)=>navigate(p==='/konto'?next:p),favorites:[],loadFavorites:async()=>{}};
 let page;
 if(!ready)page=<Loading/>;
 else if(path.startsWith('/reset'))page=<Reset/>;
 else if(login)page=<Login/>;
 else if(user?.role!==kind)page=<div className="container section"><Notice error>To konto nie ma dostępu do tego panelu.</Notice></div>;
 else if(kind==='owner')page=<Business tab={route.tab} id={route.id}/>;
 else page=<Operator tab={route.tab} id={route.id}/>;
 return <Context.Provider value={context}>
 <a href="#main" className="skip-link">Przejdź do treści</a>
 <div className="local-ribbon"><span className="status-dot"/> Wersja lokalna · Płatności testowe</div>
 <header><div className="container site-header"><a className="brand" href={portalOrigin}><img src="/assets/logo-dark.png" alt="Vanly.me — Jedź po swoje!" width={2138} height={368}/></a><a href={portalOrigin} className="text-link">Przejdź do portalu</a>{user && <button className="icon-btn" aria-label="Wyloguj" onClick={()=>act(async()=>{await api('/auth/logout','POST');await session();navigate('/login');})}><LogOut size={20}/></button>}</div></header>
 {notice && <div className={'toast '+(notice.error?'error':'')} role={notice.error?'alert':'status'}><span>{notice.text}</span><button aria-label="Zamknij komunikat" onClick={()=>setNotice(null)}><X size={18}/></button></div>}
 <main id="main" key={path}>{page}</main>
 </Context.Provider>;
}
