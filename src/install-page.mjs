// Install page shared by the Stremio addons: header, manifest URL with a copy
// button, install buttons, and a read-only "what's included" panel.
//
// The master copy lives in stremio-addons/ui-kit/install-page.mjs. Each addon repo
// keeps an identical copy in src/install-page.mjs. Edit the master, then run
// `node ui-kit/sync.mjs` from stremio-addons/ to copy it into every repo.
//
// Settings are shown ticked and disabled: the addons are static files, so every
// catalog is always included and there is nothing to choose yet.

export const KIT_VERSION = "1.2.0";

// Every addon in the family. Each page's footer links to all of them except itself
// (matched on `name`, which must equal the addon's manifest name).
export const ADDONS = [
  { name: "Streaming Originals", icon: "film", blurb: "Streaming service originals", href: "https://jantoom.github.io/streaming-originals/" },
  { name: "Live Channels", icon: "tv", blurb: "Free live TV by country", href: "https://jantoom.github.io/live-channels/" },
  { name: "Movie & Series Collections", icon: "stack", blurb: "Watch orders and franchises", href: "https://jantoom.github.io/movie-series-collections/" },
];

const ICONS = {
  film: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 7.5h4M3 12h18M3 16.5h4M17 7.5h4M17 16.5h4"/>',
  tv: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="m17 2-5 5-5-5"/>',
  stack: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 12 10 5 10-5"/><path d="m2 17 10 5 10-5"/>',
};
const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const LOCK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * @param {object} page
 * @param {string} page.name           addon name
 * @param {string} [page.version]
 * @param {string} page.tagline        one line under the name (text)
 * @param {keyof ICONS} [page.icon]
 * @param {string} page.manifestUrl    absolute, or relative ("manifest.json") to resolve in the browser
 * @param {{value: string|number, label: string}[]} [page.stats]
 * @param {Group[]} [page.groups]      the "what's included" panel
 * @param {string} [page.groupsTitle]
 * @param {string} [page.about]        trusted HTML: how to find the addon in Stremio, sources, caveats
 * @param {{label: string, href: string}[]} [page.links]
 *
 * @typedef {object} Group
 * @property {string} title
 * @property {string} [detail]         e.g. "77 collections"
 * @property {string} [choicesLabel]   heading over the choices, e.g. "Services"
 * @property {"chips"|"grid"} [layout] chips: compact pills; grid: cards with a badge
 * @property {{label: string, detail?: string, badge?: string}[]} choices
 */
export function installPage(page) {
  const { name, version, tagline, icon = "stack", manifestUrl, stats = [], groups = [], about = "", links = [] } = page;
  const absolute = /^https?:\/\//.test(manifestUrl);
  const stremio = absolute ? manifestUrl.replace(/^https?:\/\//, "stremio://") : "#";
  const web = absolute ? `https://web.stremio.com/#/addons?addon=${encodeURIComponent(manifestUrl)}` : "#";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(name)}</title><meta name="description" content="${esc(tagline)}">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(iconSvg(icon, "#7b5bf2"))}">
<style>${CSS}</style></head><body><main class="page">
<header class="hero">
  <div class="logo">${iconSvg(icon)}</div>
  <div><h1>${esc(name)}${version ? ` <span class="ver">v${esc(version)}</span>` : ""}</h1><p class="tagline">${esc(tagline)}</p></div>
</header>
${stats.length ? `<ul class="stats">${stats.map((s) => `<li><b>${esc(fmt(s.value))}</b><span>${esc(s.label)}</span></li>`).join("")}</ul>` : ""}
<section class="card install" aria-labelledby="manifest-label">
  <p class="eyebrow" id="manifest-label">Manifest URL</p>
  <div class="url">
    <code id="manifest-url">${esc(manifestUrl)}</code>
    <button class="copy" id="copy" type="button" aria-label="Copy manifest URL">${COPY_ICON}${CHECK_ICON}<span>Copy</span></button>
  </div>
  <div class="actions">
    <a class="btn primary" id="install" href="${esc(stremio)}">Install in Stremio</a>
    <a class="btn" id="web" href="${esc(web)}" target="_blank" rel="noopener">Open in Stremio Web</a>
  </div>
  <p class="hint">Or copy the URL and paste it into the search box on Stremio's Addons page.</p>
</section>
${groups.length ? `<section class="card included" aria-labelledby="included-title">
  <div class="section-head"><h2 id="included-title">${esc(page.groupsTitle || "What's included")}</h2><span class="lock">${LOCK_ICON}Everything included</span></div>
  <p class="note">These are the catalogs this addon installs. Picking your own selection isn't available yet, so everything stays ticked.</p>
  <div class="groups">${groups.map(group).join("\n  ")}</div>
</section>` : ""}
${about ? `<section class="about">${about}</section>` : ""}
${footer(name, links)}
</main><script>${SCRIPT}</script></body></html>`;
}

// Each catalog is its own boxed panel so its choices can't be mistaken for the
// next catalog's.
function group(g, i) {
  const layout = g.layout === "grid" ? "grid" : "chips";
  const choice = (c) => `<label class="choice"><input type="checkbox" checked disabled>`
    + `<span class="tick">${CHECK_ICON}</span>`
    + (c.badge ? `<span class="badge">${esc(c.badge)}</span>` : "")
    + `<span class="label">${esc(c.label)}</span>`
    + (c.detail ? `<span class="detail">${esc(c.detail)}</span>` : "")
    + `</label>`;
  return `<div class="group" role="group" aria-labelledby="group-${i}">
    <div class="group-head"><label class="switch"><input type="checkbox" role="switch" checked disabled aria-labelledby="group-${i}"><span></span></label>`
    + `<span class="group-title" id="group-${i}">${esc(g.title)}</span>${g.detail ? `<span class="detail">${esc(g.detail)}</span>` : ""}</div>
    <div class="group-body">${g.choicesLabel ? `<p class="eyebrow">${esc(g.choicesLabel)}</p>` : ""}<div class="${layout}">${g.choices.map(choice).join("")}</div></div>
  </div>`;
}

function footer(name, links) {
  const others = ADDONS.filter((a) => a.name !== name);
  if (!others.length && !links.length) return "";
  const addon = (a) => `<a class="addon" href="${esc(a.href)}"><span class="addon-icon">${iconSvg(a.icon)}</span>`
    + `<span><b>${esc(a.name)}</b><span>${esc(a.blurb)}</span></span></a>`;
  return `<footer>`
    + (others.length ? `<nav class="more" aria-labelledby="more-title"><p class="eyebrow" id="more-title">More addons</p><div class="addons">${others.map(addon).join("")}</div></nav>` : "")
    + (links.length ? `<div class="links">${links.map((l) => `<a href="${esc(l.href)}">${esc(l.label)}</a>`).join("")}</div>` : "")
    + `</footer>`;
}

function iconSvg(icon, stroke = "currentColor") {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[icon] || ICONS.stack}</svg>`;
}

const fmt = (v) => (typeof v === "number" ? v.toLocaleString("en-US") : v);

const CSS = `
:root{color-scheme:light;--bg:#f5f4fa;--surface:#fff;--surface-2:#f0eef8;--border:#e3e0ee;--fg:#16141f;--muted:#68647a;
--accent:#7b5bf2;--accent-2:#b65bf2;--accent-fg:#fff;--accent-soft:rgba(123,91,242,.11);--on:#8f7bd6;--shadow:0 1px 2px rgba(22,20,31,.04),0 8px 24px rgba(22,20,31,.06)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--bg:#0d0c12;--surface:#16141e;--surface-2:#1e1b29;--border:#2b2738;
--fg:#f0eef7;--muted:#a19cb3;--accent:#8c72ff;--accent-2:#c072ff;--accent-soft:rgba(140,114,255,.15);--on:#7d6bc4;--shadow:0 1px 2px rgba(0,0,0,.3),0 8px 24px rgba(0,0,0,.25)}}
:root[data-theme="dark"]{color-scheme:dark;--bg:#0d0c12;--surface:#16141e;--surface-2:#1e1b29;--border:#2b2738;
--fg:#f0eef7;--muted:#a19cb3;--accent:#8c72ff;--accent-2:#c072ff;--accent-soft:rgba(140,114,255,.15);--on:#7d6bc4;--shadow:0 1px 2px rgba(0,0,0,.3),0 8px 24px rgba(0,0,0,.25)}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
background:radial-gradient(1100px 420px at 50% -160px,var(--accent-soft),transparent 70%),var(--bg);background-color:var(--bg)}
svg{width:1em;height:1em;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
a{color:var(--accent)}
.page{max-width:820px;margin:0 auto;padding:40px 16px 56px;display:flex;flex-direction:column;gap:20px}
.hero{display:flex;gap:16px;align-items:center}
.logo{width:56px;height:56px;border-radius:16px;display:grid;place-items:center;color:#fff;font-size:28px;flex:none;
background:linear-gradient(135deg,var(--accent),var(--accent-2));box-shadow:0 6px 20px var(--accent-soft)}
h1{margin:0;font-size:26px;line-height:1.2;letter-spacing:-.01em}
.ver{font-size:12px;font-weight:600;color:var(--muted);background:var(--surface-2);border:1px solid var(--border);border-radius:99px;padding:2px 8px;vertical-align:middle}
.tagline{margin:4px 0 0;color:var(--muted)}
.stats{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:8px}
.stats li{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:8px 14px;display:flex;gap:6px;align-items:baseline}
.stats b{font-size:17px}.stats span{color:var(--muted);font-size:13px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:18px;padding:22px;box-shadow:var(--shadow)}
.eyebrow{margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.url{display:flex;align-items:stretch;gap:6px;padding:6px 6px 6px 16px;border-radius:14px;border:1.5px solid transparent;
background:linear-gradient(var(--surface-2),var(--surface-2)) padding-box,linear-gradient(135deg,var(--accent),var(--accent-2)) border-box}
.url code{flex:1;min-width:0;align-self:center;padding:8px 0;font:600 15px/1.45 ui-monospace,"Cascadia Code",Consolas,monospace;color:var(--fg);word-break:break-all;user-select:all}
.copy{display:inline-flex;align-items:center;gap:6px;border:0;border-radius:10px;padding:0 14px;min-height:42px;font:600 14px system-ui,sans-serif;
background:var(--accent);color:var(--accent-fg);cursor:pointer;transition:filter .15s,transform .1s}
.copy:hover{filter:brightness(1.1)}.copy:active{transform:scale(.97)}
.copy:focus-visible,.btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.copy svg{font-size:16px}.copy svg+svg{display:none}
.copy[data-copied] svg:first-child{display:none}.copy[data-copied] svg+svg{display:block}.copy[data-copied]{background:#1f9d63}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 18px;border-radius:12px;font-weight:600;text-decoration:none;
color:var(--fg);background:var(--surface-2);border:1px solid var(--border);transition:filter .15s}
.btn:hover{filter:brightness(.97)}
.btn.primary{color:var(--accent-fg);border-color:transparent;background:linear-gradient(135deg,var(--accent),var(--accent-2))}
.btn.primary:hover{filter:brightness(1.08)}
.hint{margin:12px 0 0;color:var(--muted);font-size:13px}
.section-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px}
h2{margin:0;font-size:18px}
.lock{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--muted);background:var(--surface-2);border:1px solid var(--border);border-radius:99px;padding:4px 10px}
.note{margin:6px 0 4px;color:var(--muted);font-size:13px}
.groups{display:flex;flex-direction:column;gap:16px;margin-top:16px}
.group{border:1px solid var(--border);border-radius:14px;background:var(--surface-2);overflow:hidden}
.group-head{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border);
background:color-mix(in srgb,var(--surface) 55%,var(--surface-2))}
.group-body{padding:14px 16px 16px}
.group-title{font-weight:650}
.group-head .detail{margin-left:auto}
.detail{color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}
.switch{position:relative;display:inline-flex;cursor:not-allowed}
.switch input{position:absolute;opacity:0;pointer-events:none}
.switch span{width:36px;height:20px;border-radius:99px;background:var(--on);position:relative;opacity:.85}
.switch span::after{content:"";position:absolute;top:2px;left:18px;width:16px;height:16px;border-radius:50%;background:#fff}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));gap:8px}
.choice{position:relative;display:inline-flex;align-items:center;gap:8px;padding:7px 12px 7px 8px;border-radius:10px;cursor:not-allowed;user-select:none;
background:var(--accent-soft);border:1px solid color-mix(in srgb,var(--on) 35%,transparent);font-size:14px}
.choice input{position:absolute;opacity:0;pointer-events:none}
.tick{width:18px;height:18px;border-radius:5px;display:grid;place-items:center;background:var(--on);color:#fff;font-size:13px;flex:none}
.tick svg{stroke-width:3}
.badge{font:700 11px ui-monospace,Consolas,monospace;letter-spacing:.04em;color:var(--muted);background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:1px 5px}
.grid .choice{padding:10px 12px 10px 10px}
.grid .choice .detail{margin-left:auto}
.chips .choice .detail::before{content:"· "}
.about{color:var(--muted);padding:0 4px}
.about p{margin:0 0 10px}.about b,.about strong{color:var(--fg)}
footer{display:flex;flex-direction:column;gap:16px;padding:16px 4px 0;border-top:1px solid var(--border)}
.addons{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}
.addon{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:14px;text-decoration:none;color:var(--fg);
background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow);transition:border-color .15s,transform .1s}
.addon:hover{border-color:var(--accent)}.addon:active{transform:scale(.99)}
.addon:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.addon-icon{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;flex:none;font-size:18px;color:#fff;
background:linear-gradient(135deg,var(--accent),var(--accent-2))}
.addon b{display:block;font-size:14px;line-height:1.3}.addon b+span{display:block;color:var(--muted);font-size:12px}
.links{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:14px}
@media (max-width:480px){.page{padding-top:28px}.card{padding:16px;border-radius:16px}h1{font-size:22px}
.url{flex-direction:column;padding:10px}.url code{padding:4px 4px 0}.copy{justify-content:center}.actions .btn{flex:1 1 100%}
.group-head{padding:10px 12px}.group-body{padding:12px}.grid{grid-template-columns:1fr 1fr}.grid .choice .detail{display:none}}
`;

// Resolves a relative manifest URL (local `npm run serve`), fills in the install
// links, and copies the URL. The synchronous execCommand copy goes first because
// some embedded browsers leave navigator.clipboard.writeText pending forever.
const SCRIPT = `(()=>{
const code=document.getElementById("manifest-url"),btn=document.getElementById("copy"),label=btn.querySelector("span");
const url=new URL(code.textContent,location.href).href;code.textContent=url;
document.getElementById("install").href=url.replace(/^https?:\\/\\//,"stremio://");
document.getElementById("web").href="https://web.stremio.com/#/addons?addon="+encodeURIComponent(url);
let timer;
function done(ok){btn.toggleAttribute("data-copied",ok);label.textContent=ok?"Copied":"Press Ctrl+C";clearTimeout(timer);
timer=setTimeout(()=>{btn.removeAttribute("data-copied");label.textContent="Copy"},1800)}
function select(){const r=document.createRange();r.selectNodeContents(code);const s=getSelection();s.removeAllRanges();s.addRange(r)}
function legacyCopy(){const t=document.createElement("textarea");t.value=url;t.setAttribute("readonly","");t.style.cssText="position:fixed;opacity:0";
document.body.appendChild(t);t.select();let ok=false;try{ok=document.execCommand("copy")}catch{}t.remove();return ok}
btn.addEventListener("click",()=>{if(legacyCopy())return done(true);
if(!navigator.clipboard){select();return done(false)}navigator.clipboard.writeText(url).then(()=>done(true),()=>{select();done(false)})});
})();`;
