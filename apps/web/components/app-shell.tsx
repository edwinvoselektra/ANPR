"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { PERMISSIONS } from "@anpr/shared";
import { api } from "@/lib/api";
import { Icon } from "./icons";

type User = { id:string; displayName: string; username: string; roles: string[]; permissions: string[] };
const UserContext=createContext<User|undefined>(undefined);
export const useCurrentUser=()=>useContext(UserContext);
type NavigationItem = { href: string; icon: string; label: string; permission?: string };
const items: readonly NavigationItem[] = [
  { href: "/", icon: "dashboard", label: "Dashboard" },
  { href: "/passages", icon: "camera", label: "Live passages", permission: PERMISSIONS.PASSAGES_VIEW },
  { href: "/hits", icon: "hit", label: "Hits", permission: PERMISSIONS.HITS_VIEW },
  { href: "/search", icon: "search", label: "Zoeken", permission: PERMISSIONS.PASSAGES_VIEW },
  { href: "/plates", icon: "plate", label: "Kentekens", permission: PERMISSIONS.PASSAGES_VIEW },
  { href: "/groups", icon: "groups", label: "Groepen", permission: PERMISSIONS.PASSAGES_VIEW },
  { href: "/cameras", icon: "camera", label: "Camera’s" },
  { href: "/locations", icon: "location", label: "Locaties", permission: PERMISSIONS.LOCATIONS_VIEW },
  { href: "/users", icon: "users", label: "Gebruikers", permission: PERMISSIONS.USERS_MANAGE },
  { href: "/simulator", icon: "demo", label: "Demo / simulator", permission: PERMISSIONS.SIMULATOR_RUN },
  { href: "/system", icon: "health", label: "Systeemstatus", permission: PERMISSIONS.SYSTEM_VIEW }
  ,{ href: "/settings", icon: "settings", label: "Instellingen" }
];
const future = ["Live camera’s", "Kaart", "Meldkamer", "Auditlog"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User>();
  const [open, setOpen] = useState(false);
  const[mobile,setMobile]=useState(false);const drawer=useRef<HTMLElement>(null);const menuButton=useRef<HTMLButtonElement>(null);
  useEffect(()=>{if(!window.matchMedia)return;const query=window.matchMedia("(max-width: 800px)");const update=()=>{setMobile(query.matches);if(!query.matches)setOpen(false)};update();query.addEventListener("change",update);return()=>query.removeEventListener("change",update)},[]);
  useEffect(()=>{if(!open||!mobile)return;const before=document.body.style.overflow;document.body.style.overflow="hidden";drawer.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const key=(e:KeyboardEvent)=>{if(e.key==="Escape")setOpen(false);if(e.key==="Tab"){const nodes=Array.from(drawer.current?.querySelectorAll<HTMLElement>("a,button")??[]);const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}};
    document.addEventListener("keydown",key);return()=>{document.body.style.overflow=before;document.removeEventListener("keydown",key);menuButton.current?.focus()};
  },[open,mobile]);
  const loginPage = path === "/login";
  useEffect(() => {
    if (loginPage) return;
    api<{ user: User }>("/auth/me").then((data) => setUser(data.user)).catch(() => router.replace("/login"));
  }, [loginPage, router]);
  if (loginPage) return <>{children}</>;
  if (!user) return <div className="loading"><span className="spinner"/>Beveiligde omgeving laden…</div>;
  const logout = async () => { await api("/auth/logout", { method: "POST" }); setUser(undefined); setOpen(false); router.replace("/login"); };
  return <UserContext.Provider value={user}><div className="app-layout">
    <aside ref={drawer} id="mobile-navigation" inert={mobile&&!open} role={mobile?"dialog":undefined} aria-modal={mobile&&open?true:undefined} aria-label="Navigatiemenu" className={`sidebar ${open ? "open" : ""}`}>
      <div className="brand"><button className="drawer-close" aria-label="Menu sluiten" onClick={()=>setOpen(false)}>×</button><div className="brand-mark">A</div><div><strong>ANPR Platform</strong><span>Buurtpreventie</span></div></div>
      <nav aria-label="Hoofdnavigatie">
        <div className="nav-label">Platform</div>
        {items.filter(({ permission }) => !permission || user.permissions.includes(permission)).map(({ href, icon, label }) =>
          <Link key={href} href={href} aria-current={path===href||href!=="/"&&path.startsWith(href)?"page":undefined} className={path === href || href !== "/" && path.startsWith(href) ? "active" : ""} onClick={() => setOpen(false)}><Icon name={icon}/>{label}</Link>)}
        <div className="nav-label">Toekomstige fases</div>
        {future.map((label) => <span className="nav-disabled" key={label}>{label}<small>Later</small></span>)}
      </nav>
      <div className="profile"><div className="avatar">{user.displayName.slice(0, 1).toUpperCase()}</div><div><strong>{user.displayName}</strong><span>{user.roles.join(", ")}</span></div><button aria-label="Uitloggen" onClick={logout}><Icon name="logout"/></button></div>
    </aside>
    {open && <button className="scrim" onClick={() => setOpen(false)} aria-label="Menu sluiten"/>}
    <main className="main" inert={mobile&&open}><header className="mobile-header"><button ref={menuButton} aria-label="Menu openen" aria-controls="mobile-navigation" aria-expanded={open} onClick={() => setOpen(true)}><Icon name="menu"/></button><strong>ANPR Platform</strong></header>{children}</main>
  </div></UserContext.Provider>;
}
