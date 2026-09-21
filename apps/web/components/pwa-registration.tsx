"use client";

import { useEffect } from "react";

export function PwaRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).then((registration) => registration.update()).catch(() => {
      // De gewone webapp blijft werken als registratie niet wordt ondersteund.
    });
  }, []);
  return null;
}
