"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PERMISSIONS } from "@anpr/shared";
import { api } from "@/lib/api";
import { Icon } from "./icons";

type User = { displayName: string; username: string; roles: string[]; permissions: string[] };
type NavigationItem = { href: string; icon: string; label: string; permission?: string };
const items: readonly NavigationItem[] = [
  { href: "/", icon: "dashboard", label: "Dashboard" },
  { href: "/passages", icon: "camera", label: "Live passages", permission: PERMISSIONS.PASSAGES_VIEW },
  { href: "/hits", icon: "hit", label: "Hits", permission: PERMISSIONS.HITS_VIEW },
  { href: "/search", icon: "search", label: "Zoeken", permission: PERMISSIONS.PASSAGES_VIEW },
  { href: "/plates", icon: "plate", label: "Kentekens", permission: PERMISSIONS.PASSAGES_VIEW },
  { href: "/groups", icon: "groups", label: "Groepen", permission: PERMISSIONS.PASSAGES_VIEW },
  { href: "/cameras", icon: "camera", label: "Camera’s" },
  { href: "/users", icon: "users", label: "Gebruikers", permission: PERMISSIONS.USERS_MANAGE },
  { href: "/simulator", icon: "demo", label: "Demo / simulator", permission: PERMISSIONS.SIMULATOR_RUN },
  { href: "/system", icon: "health", label: "Systeemstatus", permission: PERMISSIONS.SYSTEM_VIEW }
];
const future = ["Live camera’s", "Kaart", "Meldkamer", "Auditlog", "Instellingen"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User>();
  const [open, setOpen] = useState(false);
  const loginPage = path === "/login";
  useEffect(() => {
    if (loginPage) return;
    api<{ user: User }>("/auth/me").then((data) => setUser(data.user)).catch(() => router.replace("/login"));
  }, [loginPage, router]);
  if (loginPage) return <>{children}</>;
  if (!user) return <div className="loading"><span className="spinner"/>Beveiligde omgeving laden…</div>;
  const logout = async () => { await api("/auth/logout", { method: "POST" }); router.replace("/login"); };
  return <div className="app-layout">
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <div className="brand"><div className="brand-mark">A</div><div><strong>ANPR Platform</strong><span>Buurtpreventie</span></div></div>
      <nav aria-label="Hoofdnavigatie">
        <div className="nav-label">Platform</div>
        {items.filter(({ permission }) => !permission || user.permissions.includes(permission)).map(({ href, icon, label }) =>
          <Link key={href} href={href} className={path === href || href !== "/" && path.startsWith(href) ? "active" : ""} onClick={() => setOpen(false)}><Icon name={icon}/>{label}</Link>)}
        <div className="nav-label">Toekomstige fases</div>
        {future.map((label) => <span className="nav-disabled" key={label}>{label}<small>Later</small></span>)}
      </nav>
      <div className="profile"><div className="avatar">{user.displayName.slice(0, 1).toUpperCase()}</div><div><strong>{user.displayName}</strong><span>{user.roles.join(", ")}</span></div><button aria-label="Uitloggen" onClick={logout}><Icon name="logout"/></button></div>
    </aside>
    {open && <button className="scrim" onClick={() => setOpen(false)} aria-label="Menu sluiten"/>}
    <main className="main"><header className="mobile-header"><button onClick={() => setOpen(true)}><Icon name="menu"/></button><strong>ANPR Platform</strong></header>{children}</main>
  </div>;
}
