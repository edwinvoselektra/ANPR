"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState(""); const [password, setPassword] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError("");
    try { await api("/auth/login", { method: "POST", body: JSON.stringify({ identifier, password }) }); router.replace("/"); }
    catch (value) { setError(value instanceof ApiError ? value.message : "Inloggen mislukt."); } finally { setBusy(false); }
  };
  return <div className="login"><section className="login-visual"><div className="login-logo"><div className="brand-mark">A</div><strong>ANPR Platform</strong></div><div><h1>Veilig zicht op wat er in de buurt gebeurt.</h1><p>Een professioneel platform voor camerabeheer, voertuigpassages en buurtpreventie. Fase 1 bevat beheer en een duidelijk gemarkeerde demosimulator.</p></div><div className="login-status"><span className="dot"/>Beveiligde lokale ontwikkelomgeving</div></section><section className="login-panel"><form className="login-box" onSubmit={submit}><div className="login-logo"><div className="brand-mark">A</div><strong>ANPR Platform</strong></div><h2>Welkom terug</h2><p>Log in met je e-mailadres of gebruikersnaam.</p>{error && <div className="alert error">{error}</div>}<div className="field"><label htmlFor="identifier">E-mail of gebruikersnaam</label><input id="identifier" autoComplete="username" required value={identifier} onChange={(e)=>setIdentifier(e.target.value)}/></div><div className="field"><label htmlFor="password">Wachtwoord</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e)=>setPassword(e.target.value)}/></div><button className="button" disabled={busy}>{busy ? "Bezig met inloggen…" : "Inloggen"}</button><div className="login-foot">Geen standaardaccount. De beheerder wordt veilig via de terminal aangemaakt.</div></form></section></div>;
}
