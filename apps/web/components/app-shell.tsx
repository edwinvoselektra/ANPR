"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { PERMISSIONS } from "@anpr/shared";
import { api, ApiError } from "@/lib/api";
import { Icon } from "./icons";

type User = { id:string; displayName: string; username: string; roles: string[]; permissions: string[] };
type AuthState =
  | { status: "loading" }
  | { status: "authenticated"; user: User }
  | { status: "unauthenticated" }
  | { status: "error"; message: string };

const AUTH_CHECK_TIMEOUT_MS = 10_000;
const UserContext=createContext<User|undefined>(undefined);
export const useCurrentUser=()=>useContext(UserContext);
type NavigationItem = { href: string; icon: string; label: string; permission?: string };
const items: readonly NavigationItem[] = [
  { href: "/", icon: "dashboard", label: "Dashboard" },
  { href: "/passages", icon: "camera", label: "Live passages", permission: PERMISSIONS.PASSAGES_VIEW },
  { href: "/hits", icon: "hit", label: "Hits", permission: PERMISSIONS.HITS_VIEW },
  { href: "/search", icon: "search", label: "Zoeken", permission: PERMISSIONS.PASSAGES_VIEW },
  { href: "/plates", icon: "plate", label: "Kentekens", permission: PERMISSIONS.PASSAGES_VIEW },
  { href: "/patterns", icon: "search", label: "Opvallende patronen", permission: PERMISSIONS.PASSAGES_VIEW },
  { href: "/groups", icon: "groups", label: "Groepen", permission: PERMISSIONS.PASSAGES_VIEW },
  { href: "/cameras", icon: "camera", label: "Camera’s" },
  { href: "/locations", icon: "location", label: "Locaties", permission: PERMISSIONS.LOCATIONS_VIEW },
  { href: "/users", icon: "users", label: "Gebruikers", permission: PERMISSIONS.USERS_MANAGE },
  { href: "/simulator", icon: "demo", label: "Demo / simulator", permission: PERMISSIONS.SIMULATOR_RUN },
  { href: "/system", icon: "health", label: "Systeemstatus", permission: PERMISSIONS.SYSTEM_VIEW }
  ,{ href: "/settings", icon: "settings", label: "Instellingen" }
];
const future = ["Live camera’s", "Kaart", "Meldkamer", "Auditlog"];

function isUser(value: unknown): value is User {
  if (!value || typeof value !== "object") return false;
  const user = value as Partial<User>;
  return typeof user.id === "string" && typeof user.displayName === "string" && typeof user.username === "string"
    && Array.isArray(user.roles) && user.roles.every((role) => typeof role === "string")
    && Array.isArray(user.permissions) && user.permissions.every((permission) => typeof permission === "string");
}

function SessionFallback({ state, retry }: { state: Extract<AuthState, { status: "unauthenticated" | "error" }>; retry: () => void }) {
  const unavailable = state.status === "error";
  return <div className="auth-fallback" data-auth-state={state.status} role="alert">
    <section className="card">
      <h1>{unavailable ? "Sessiecontrole mislukt" : "Sessie verlopen"}</h1>
      <p>{unavailable ? state.message : "Je sessie ontbreekt of is verlopen. Log opnieuw in."}</p>
      <div className="actions">
        {unavailable && <button className="button secondary" type="button" onClick={retry}>Opnieuw proberen</button>}
        <a className="button" href="/login">Naar inloggen</a>
      </div>
    </section>
  </div>;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  const [authAttempt, setAuthAttempt] = useState(0);
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
    let active = true;
    const controller = new AbortController();
    let timer: number | undefined;
    setAuth({ status: "loading" });
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = window.setTimeout(() => {
        controller.abort();
        reject(new Error("AUTH_CHECK_TIMEOUT"));
      }, AUTH_CHECK_TIMEOUT_MS);
    });
    void Promise.race([
      api<unknown>("/auth/me", { cache: "no-store", signal: controller.signal }),
      timeout
    ]).then((data) => {
      if (!active) return;
      const candidate = data && typeof data === "object" ? (data as { user?: unknown }).user : undefined;
      if (!isUser(candidate)) throw new Error("AUTH_RESPONSE_INVALID");
      setAuth({ status: "authenticated", user: candidate });
    }).catch((error: unknown) => {
      if (!active) return;
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        setAuth({ status: "unauthenticated" });
        router.replace("/login");
        return;
      }
      setAuth({ status: "error", message: "Sessie kon niet worden gecontroleerd. Probeer het opnieuw of log opnieuw in." });
    }).finally(() => {
      if (timer !== undefined) window.clearTimeout(timer);
    });
    return () => {
      active = false;
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [authAttempt, loginPage, router]);
  if (loginPage) return <>{children}</>;
  if (auth.status === "loading") return <div className="loading" data-auth-state="loading"><span className="spinner"/>Beveiligde omgeving laden…</div>;
  if (auth.status === "unauthenticated" || auth.status === "error") {
    return <SessionFallback state={auth} retry={() => setAuthAttempt((attempt) => attempt + 1)}/>;
  }
  const user = auth.user;
  const logout = async () => {
    try {
      await api("/auth/logout", { method: "POST" });
      setAuth({ status: "unauthenticated" });
      setOpen(false);
      router.replace("/login");
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        setAuth({ status: "unauthenticated" });
        router.replace("/login");
        return;
      }
      setAuth({ status: "error", message: "Uitloggen kon niet worden bevestigd. Probeer het opnieuw." });
    }
  };
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
