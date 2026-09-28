/* Bilingual strings (en/es) + detection.
   - Pre-paint: tiny inline script in Base.astro sets data-lang from
     localStorage, else navigator.language, else "en".
   - Static Astro markup uses data-i18n="key" (English fallback content
     ships in the HTML, swapped on load when needed).
   - React islands use useLang() + t() so they re-render on switch.
   New user-facing strings go here, never inline. */

import { useSyncExternalStore } from "react";

export type Lang = "en" | "es";
export const LANGS: Lang[] = ["en", "es"];
const STORE_KEY = "uxn.lang";

export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved === "en" || saved === "es") return saved;
  } catch {
    /* private mode — fall through to navigator */
  }
  if (typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("es")) {
    return "es";
  }
  return "en";
}

export function setLang(lang: Lang): void {
  document.documentElement.dataset.lang = lang;
  try {
    localStorage.setItem(STORE_KEY, lang);
  } catch {
    /* private mode — selection just won't persist */
  }
  window.dispatchEvent(new CustomEvent<Lang>("uxn:lang", { detail: lang }));
}

function subscribe(cb: () => void): () => void {
  window.addEventListener("uxn:lang", cb);
  return () => window.removeEventListener("uxn:lang", cb);
}

function snapshot(): Lang {
  return document.documentElement.dataset.lang === "es" ? "es" : "en";
}

export function useLang(): Lang {
  return useSyncExternalStore(subscribe, snapshot, () => "en" as Lang);
}

export const STRINGS: Record<Lang, Record<string, string>> = {
  en: {
    "nav.studio": "Studio",
    "nav.targets": "Targets",
    "nav.features": "Features",
    "nav.login": "Log in",
    "nav.signup": "Sign up",
    "nav.logout": "Log out",
    "nav.menu": "Menu",
    "hero.badge": "Compiler daemon · online",
    "hero.title_pre": "Low-code games for the",
    "hero.title_accent": "Uxn",
    "hero.title_post": "virtual machine",
    "hero.sub":
      "Compose scenes, sprites and event graphs visually. We emit typed ETAL, compile it on the backend, and hand you a ROM that runs on Linux, macOS, Windows and the web.",
    "hero.cta1": "Start building",
    "hero.cta2": "Open studio",
    "hero.s1k": "etal",
    "hero.s1v": "typed DSL → Uxntal",
    "hero.s2k": "60 FPS",
    "hero.s2v": "frame-vector runtime",
    "hero.s3k": "256 B",
    "hero.s3v": "zero-page budget",
    "hero.s4k": "1 ROM",
    "hero.s4v": "everywhere",
    "feat.kicker": "[01 / workstation]",
    "feat.title": "An editor that speaks machine",
    "feat.1t": "Scene editor",
    "feat.1b":
      "Hierarchy, canvas viewport and inspector — the dockable workstation from the reference, rebuilt in Catppuccin.",
    "feat.2t": "Visual event graph",
    "feat.2b":
      "on_click, on_hold, drag and key bindings as nodes. They lower to ETAL vectors, never black boxes.",
    "feat.3t": "Sprite studio",
    "feat.3b":
      "Pixel canvases and animation rails that export .chr tiles the compiler embeds with zero conversion.",
    "feat.4t": "One-click export",
    "feat.4b":
      "The backend assembles via drifblim and wraps your ROM: native bundles or a self-contained web page.",
    "tgt.kicker": "[02 / export]",
    "tgt.title": "Select target deployment engine",
    "tgt.sub": "The ROM is portable — only the VM half varies. One Linux backend wraps every row.",
    "tgt.live": "Live from compiler backend",
    "tgt.offline": "Static contract · backend offline",
    "tgt.ready": "Ready",
    "tgt.soon": "Soon",
    "tgt.export": "Export",
    "cta.title": "Ship your first ROM tonight",
    "cta.sub": "Sign up, open the studio, and export for Linux and web in minutes.",
    "cta.btn": "Create free account",
    "foot.tag": "low-code for the Uxn/Varvara machine",
    "foot.stack": "etal DSL → drifblim → .rom · linux / macos / windows / web",
    "auth.login_t": "Welcome back",
    "auth.login_s": "No account yet?",
    "auth.login_q": "Sign up",
    "auth.reg_t": "Create your account",
    "auth.reg_s": "Already building?",
    "auth.reg_q": "Log in",
    "auth.name": "Display name",
    "auth.name_ph": "pixel_pilot",
    "auth.email": "Email",
    "auth.pass": "Password",
    "auth.go_login": "Log in",
    "auth.go_signup": "Sign up",
    "auth.foot": "secured by the compiler backend · JWT session",
    "auth.e_net": "Can't reach the auth service. Is the backend running?",
    "auth.e_name": "Pick a display name of at least 2 characters.",
    "auth.e_email": "That email address looks off.",
    "auth.e_pass": "Password needs at least 8 characters.",
    "st.run": "Run",
    "st.hierarchy": "Hierarchy",
    "st.inspector": "Inspector",
    "st.active": "Active selection",
    "st.viewport": "viewport · 320×180 canvas mounts here",
    "st.graph": "Visual event & trigger graph",
    "st.palette": "Palette · 16×16",
    "st.newbind": "+ New bind",
    "st.eng": "Engine: Ready",
    "st.rend": "Renderer: pixel-perfect",
  },
  es: {
    "nav.studio": "Estudio",
    "nav.targets": "Destinos",
    "nav.features": "Funciones",
    "nav.login": "Entrar",
    "nav.signup": "Registrarse",
    "nav.logout": "Salir",
    "nav.menu": "Menú",
    "hero.badge": "Compilador · en línea",
    "hero.title_pre": "Juegos low-code para la máquina",
    "hero.title_accent": "Uxn",
    "hero.title_post": "",
    "hero.sub":
      "Compón escenas, sprites y gráficos de eventos visualmente. Emitimos ETAL tipado, lo compilamos en el backend y te entregamos una ROM que corre en Linux, macOS, Windows y la web.",
    "hero.cta1": "Empieza a crear",
    "hero.cta2": "Abrir estudio",
    "hero.s1k": "etal",
    "hero.s1v": "DSL tipado → Uxntal",
    "hero.s2k": "60 FPS",
    "hero.s2v": "motor de vectores",
    "hero.s3k": "256 B",
    "hero.s3v": "presupuesto zero-page",
    "hero.s4k": "1 ROM",
    "hero.s4v": "en todas partes",
    "feat.kicker": "[01 / estación]",
    "feat.title": "Un editor que habla máquina",
    "feat.1t": "Editor de escenas",
    "feat.1b":
      "Jerarquía, viewport e inspector — la estación acoplable de la referencia, reconstruida en Catppuccin.",
    "feat.2t": "Gráfico visual de eventos",
    "feat.2b":
      "on_click, on_hold, arrastre y teclas como nodos. Bajan a vectores ETAL, nunca cajas negras.",
    "feat.3t": "Estudio de sprites",
    "feat.3b":
      "Lienzos de píxeles y rieles de animación que exportan tiles .chr que el compilador incrusta sin conversión.",
    "feat.4t": "Exportación en un clic",
    "feat.4b":
      "El backend ensambla con drifblim y envuelve tu ROM: paquetes nativos o página web autocontenida.",
    "tgt.kicker": "[02 / exportación]",
    "tgt.title": "Elige el motor de despliegue",
    "tgt.sub": "La ROM es portable — solo varía la mitad de la VM. Un backend Linux envuelve cada fila.",
    "tgt.live": "En vivo desde el backend",
    "tgt.offline": "Contrato estático · backend sin conexión",
    "tgt.ready": "Listo",
    "tgt.soon": "Pronto",
    "tgt.export": "Exportar",
    "cta.title": "Publica tu primera ROM esta noche",
    "cta.sub": "Regístrate, abre el estudio y exporta para Linux y web en minutos.",
    "cta.btn": "Crear cuenta gratis",
    "foot.tag": "low-code para la máquina Uxn/Varvara",
    "foot.stack": "DSL etal → drifblim → .rom · linux / macos / windows / web",
    "auth.login_t": "Bienvenido de nuevo",
    "auth.login_s": "¿Sin cuenta aún?",
    "auth.login_q": "Regístrate",
    "auth.reg_t": "Crea tu cuenta",
    "auth.reg_s": "¿Ya estás creando?",
    "auth.reg_q": "Entra",
    "auth.name": "Nombre visible",
    "auth.name_ph": "pixel_piloto",
    "auth.email": "Correo",
    "auth.pass": "Contraseña",
    "auth.go_login": "Entrar",
    "auth.go_signup": "Registrarse",
    "auth.foot": "sesión JWT del backend del compilador",
    "auth.e_net": "Sin conexión con el servicio. ¿Está el backend en marcha?",
    "auth.e_name": "Elige un nombre de al menos 2 caracteres.",
    "auth.e_email": "Ese correo parece incorrecto.",
    "auth.e_pass": "La contraseña necesita al menos 8 caracteres.",
    "st.run": "Ejecutar",
    "st.hierarchy": "Jerarquía",
    "st.inspector": "Inspector",
    "st.active": "Selección activa",
    "st.viewport": "viewport · el lienzo 320×180 va aquí",
    "st.graph": "Gráfico visual de eventos",
    "st.palette": "Paleta · 16×16",
    "st.newbind": "+ Nuevo enlace",
    "st.eng": "Motor: listo",
    "st.rend": "Render: pixel-perfect",
  },
};

export function t(lang: Lang, key: string): string {
  return STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
}

/* Swap every data-i18n node. Runs on load and on each setLang(). */
export function applyStaticLang(lang: Lang): void {
  for (const el of document.querySelectorAll("[data-i18n]")) {
    const key = el.getAttribute("data-i18n");
    if (key) el.textContent = t(lang, key);
  }
}
