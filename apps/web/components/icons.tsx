export function Icon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    dashboard: <><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></>,
    camera: <><path d="M14.5 4H9L7 7H3v12h18V7h-4.5z"/><circle cx="12" cy="13" r="4"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    hit: <><path d="M12 2 3 6v6c0 5 3.8 9.7 9 10 5.2-.3 9-5 9-10V6z"/><path d="m9 12 2 2 4-5"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    plate: <><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h10M7 14h6"/></>,
    groups: <><path d="M4 5h16v5H4zM4 14h7v5H4zM15 14h5v5h-5z"/></>,
    demo: <><path d="m5 3 14 9-14 9z"/></>,
    health: <><path d="M3 12h4l2-7 4 14 2-7h6"/></>,
    logout: <><path d="M10 17l5-5-5-5M15 12H3M21 19V5a2 2 0 0 0-2-2h-6"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    trash: <><path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6"/></>,
    menu: <><path d="M4 6h16M4 12h16M4 18h16"/></>
  };
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{paths[name]}</svg>;
}
