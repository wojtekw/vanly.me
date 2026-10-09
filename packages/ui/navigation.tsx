import React, {useEffect, useState} from 'react';
import {canonicalPanelPath} from './portal-routes.mjs';
export const portalOrigin = typeof window === 'undefined'
  ? 'https://vanly.me.local'
  : window.location.origin.replace(/^(https?:\/\/)(?:owner|admin)\./, '$1');
function localPath(href: string) {
  const path = canonicalPanelPath(href);
  const prefix = window.location.hostname.startsWith('admin.') || window.location.port === '8183' ? '/operator' : '/company';
  if (/^(?:https?:\/\/|mailto:|tel:)/.test(path)) return path;
  return path === '/' || new RegExp('^' + prefix + '(?:[/?#]|$)').test(path) || /^\/(?:login|reset)(?:[/?#]|$)/.test(path) ? path : portalOrigin + path;
}
export function navigate(href: string) {
  const target = localPath(href);
  if (!target.startsWith('/')) { window.location.assign(target); return; }
  window.history.pushState({}, '', target);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
export function usePathname() {
  const currentPath = () => {
    const current = window.location.pathname + window.location.search + window.location.hash;
    const canonical = canonicalPanelPath(current);
    if (canonical !== current) window.history.replaceState(window.history.state, '', canonical);
    return canonical;
  };
  const [path,setPath] = useState(currentPath);
  useEffect(() => { const update=()=>setPath(currentPath()); window.addEventListener('popstate',update);return ()=>window.removeEventListener('popstate',update); },[]);
  return path.split(/[?#]/, 1)[0];
}
export function useSearchParams() { usePathname(); return new URLSearchParams(window.location.search); }
export default function Link({href,children,onClick,...props}: React.AnchorHTMLAttributes<HTMLAnchorElement> & {href:string}) {
  return <a {...props} href={localPath(href)} onClick={event=>{onClick?.(event);if(!event.defaultPrevented && event.button===0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && !props.target && !props.download && localPath(href).startsWith('/')){event.preventDefault();navigate(href);}}}>{children}</a>;
}
