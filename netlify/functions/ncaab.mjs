// Radar NCAAB — función de Netlify que lee TeamRankings.com y devuelve JSON.
// Sin dependencias externas: usa fetch nativo (Node 18+) y un lector de tablas HTML propio.

// ======================= CONFIGURACIÓN =======================
const SITE = "https://www.teamrankings.com";
const SCHEDULE_URL = `${SITE}/ncb/schedules/`; // se le agrega ?date=AAAA-MM-DD
const STANDINGS_URL = `${SITE}/ncb/standings/`;
const TEAM_STATS = {
  h1: `${SITE}/ncaa-basketball/stat/1st-half-points-per-game`,
  pts: `${SITE}/ncaa-basketball/stat/points-per-game`,
  three: `${SITE}/ncaa-basketball/stat/three-pointers-made-per-game`,
  // "team-rebounds" en TeamRankings son solo los rebotes que se acreditan al equipo (≈3 por juego);
  // el total de rebotes por juego está en "total-rebounds-per-game".
  reb: `${SITE}/ncaa-basketball/stat/total-rebounds-per-game`,
  ast: `${SITE}/ncaa-basketball/stat/assists-per-game`,
};
const PLAYER_STATS = {
  pts: `${SITE}/ncaa-basketball/player-stat/points`,
  ast: `${SITE}/ncaa-basketball/player-stat/assists`,
  reb: `${SITE}/ncaa-basketball/player-stat/rebounds`,
};
const TOP_PLAYERS = 5;
const STAT_KEYS = Object.keys(TEAM_STATS);
// =============================================================

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
};

// ---------- nombres de equipos ----------
// Hay nombres muy parecidos (Texas / Texas St / Texas Tech / Texas Southern, Miami / Miami OH...),
// así que NO se usa búsqueda parcial: solo el nombre exacto normalizado.
const WORDS = {
  state: "st", st: "st", north: "n", northern: "n", south: "s", southern: "s",
  east: "e", eastern: "e", west: "w", western: "w", central: "c", saint: "st",
  univ: "", university: "", the: "", of: "",
  florida: "fla", fla: "fla", fl: "fla", ohio: "oh", oh: "oh",
};
const ALIAS = {
  miamifla: "miami", ucf: "cfla", usf: "sfla", fiu: "flainternational", flaintl: "flainternational",
  fau: "flaatlantic", lsu: "louisianast", byu: "brighamyoung", tcu: "texaschristian", smu: "smethodist",
  utep: "texaselpaso", utsa: "texassanantonio", uab: "alabamabirmingham", unlv: "nevadalasvegas",
  uconn: "connecticut", umass: "massachusetts", ulmonroe: "louisianamonroe", lamonroe: "louisianamonroe",
  ullafayette: "louisiana", louisianalafayette: "louisiana", gatech: "georgiatech",
  ncst: "nst", ncstate: "nst", ncarolinast: "nst", usc: "scalifornia", pitt: "pittsburgh",
  mississippi: "olemiss", smississippi: "smiss", appst: "appalachianst", latech: "louisianatech",
  midtennessee: "mtsu", middletennessee: "mtsu", midtennst: "mtsu", bostoncol: "bostoncollege",
  coastalcar: "coastalcarolina", samhouston: "samhoustonst", sjst: "sanjosest", sanjosst: "sanjosest",
  stmarysca: "stmarys", stmaryscalifornia: "stmarys", vcu: "virginiacommonwealth",
  umbc: "marylandbaltimorecounty", uncw: "ncwilmington", uncg: "ncgreensboro", unca: "ncasheville",
  uncwilmington: "ncwilmington", uncgreensboro: "ncgreensboro", uncasheville: "ncasheville",
  siue: "siuedwardsville", liu: "longisland", liubrooklyn: "longisland", fgcu: "flagulfcoast",
  loyolachicago: "loyolachi", iupui: "iuindy", etsu: "etennesseest", mtst: "mtsu",
  // nombres largos que usan las páginas de jugadores
  csunorthridge: "csnorthridge", calstnorthridge: "csnorthridge", csufullerton: "csfullerton",
  calstfullerton: "csfullerton", csubakersfield: "csbakersfield", calstbakersfield: "csbakersfield",
  calbaptist: "californiabaptist", cconn: "cconnecticut", cconnst: "cconnecticut", cconnecticutst: "cconnecticut",
  unc: "ncarolina", unlv: "nevadalasvegas", utrgv: "texasriograndevalley", txriogrande: "texasriograndevalley",
  utarlington: "texasarlington", utmartin: "tennesseemartin", tennmartin: "tennesseemartin",
  sfaustin: "stephenfaustin", stephenfaustinst: "stephenfaustin", sfa: "stephenfaustin",
  umkc: "kansascity", mdbaltco: "marylandbaltimorecounty", ualbany: "albany", albanyny: "albany",
  purduefortwayne: "fortwayne", purduefw: "fortwayne", ipfw: "fortwayne", pfw: "fortwayne",
  iuindianapolis: "iuindy", iuindy: "iuindy",
};

function key(s) {
  const words = String(s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, "")
    .replace(/[().,'’\-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w in WORDS ? WORDS[w] : w));
  const k = words.join("").replace(/[^a-z]/g, "");
  return ALIAS[k] || k;
}
const pkey = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function num(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// ---------- descarga con reintento y límite de tiempo ----------
// needTable=false para el calendario: un día sin partidos puede venir sin tabla,
// pero debe traer el título "Schedule"; si no trae ninguno de los dos, es un bloqueo.
async function getHtml(url, needTable = true, tries = 2, timeoutMs = 3500) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { headers: HEADERS, signal: ctrl.signal, redirect: "follow" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const html = await r.text();
      const ok = /<table/i.test(html) || (!needTable && /schedule/i.test(html));
      if (!ok) throw new Error("la página no trae tablas (posible bloqueo)");
      return html;
    } catch (e) {
      lastErr = e.name === "AbortError" ? new Error("tiempo de espera agotado") : e;
      if (i < tries - 1) await sleep(300);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(lastErr ? lastErr.message : "error desconocido");
}

// ---------- lector de tablas HTML ----------
function decode(s) {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z])(acute|grave|tilde|uml|circ|cedil);/gi, (_, c, t) =>
      (c + { acute: "́", grave: "̀", tilde: "̃", uml: "̈", circ: "̂", cedil: "̧" }[t.toLowerCase()]).normalize("NFC"))
    .replace(/\s+/g, " ")
    .trim();
}

function parseTables(html) {
  const out = [];
  const reTable = /<table[\s\S]*?<\/table>/gi;
  let m;
  while ((m = reTable.exec(html))) {
    const rows = [];
    const reRow = /<tr[\s\S]*?<\/tr>/gi;
    let r;
    while ((r = reRow.exec(m[0]))) {
      const cells = [];
      const reCell = /<t([hd])[^>]*>([\s\S]*?)<\/t\1>/gi;
      let c;
      while ((c = reCell.exec(r[0]))) cells.push(decode(c[2]));
      if (cells.length) rows.push(cells);
    }
    out.push({ index: m.index, rows });
  }
  return out;
}

const cleanTeam = (s) =>
  String(s || "").replace(/\(\d+-\d+(-\d+)?\)/g, "").replace(/^#\d+\s+/, "").replace(/\s+\d+$/, "").trim();

// ---------- partidos del día ----------
// "#45 Santa Clara at #9 Gonzaga" (visita at local) o "A vs. B" (cancha neutral)
function parseSchedule(html) {
  const isHdr = (r) => r.some((c) => /matchup/i.test(c));
  const t = parseTables(html).find((t) => t.rows.some(isHdr));
  if (!t) return [];
  const hdr = t.rows.find(isHdr);
  const idx = (re) => hdr.findIndex((c) => re.test(c));
  const iM = idx(/matchup/i), iTime = idx(/^time/i), iLoc = idx(/location/i), iHot = idx(/hotness/i);

  const games = [];
  for (const r of t.rows) {
    if (isHdr(r)) continue;
    const txt = (r[iM] || "").replace(/\(\d+-\d+\)/g, "").trim();
    const mm = txt.match(/^(?:#(\d+)\s+)?(.+?)\s+(at|vs\.?|@)\s+(?:#(\d+)\s+)?(.+)$/i);
    if (!mm) continue;
    games.push({
      away: cleanTeam(mm[2]),
      awayRank: mm[1] ? +mm[1] : null,
      home: cleanTeam(mm[5]),
      homeRank: mm[4] ? +mm[4] : null,
      neutral: !/^(at|@)$/i.test(mm[3]),
      time: iTime >= 0 ? r[iTime] || "" : "",
      location: iLoc >= 0 ? r[iLoc] || "" : "",
      hotness: iHot >= 0 ? num(r[iHot]) : null,
    });
  }
  return games;
}

// ---------- tabla de posiciones (una tabla por conferencia) ----------
// Orden importa: los nombres más específicos primero.
const CONFS = [
  ["Atlantic 10", /atlantic\s*10|\bA[\s-]*10\b/i], ["ASUN", /atlantic\s*sun|\bASUN\b/i],
  ["ACC", /\bACC\b|atlantic\s*coast/i], ["America East", /america\s*east/i],
  ["American", /\bAAC\b|american\s*athletic|^american\b/i], ["Big East", /big\s*east/i],
  ["Big Sky", /big\s*sky/i], ["Big South", /big\s*south/i], ["Big West", /big\s*west/i],
  ["Big Ten", /big\s*ten|big\s*10/i], ["Big 12", /big\s*12|big\s*twelve/i],
  ["SEC", /\bSEC\b|southeastern/i], ["SWAC", /\bSWAC\b|southwestern\s*athletic/i],
  ["Southland", /southland/i], ["SoCon", /\bSoCon\b|^southern\b|southern\s*conf/i],
  ["MEAC", /\bMEAC\b|mid[\s-]*eastern/i], ["MAC", /\bMAC\b|mid[\s-]*american/i],
  ["MAAC", /\bMAAC\b|metro\s*atlantic/i], ["Mountain West", /mountain\s*west|\bMWC\b/i],
  ["MVC", /\bMVC\b|missouri\s*valley/i], ["OVC", /\bOVC\b|ohio\s*valley/i],
  ["NEC", /\bNEC\b|northeast/i], ["CAA", /\bCAA\b|colonial|coastal\s*athletic/i],
  ["C-USA", /conference\s*usa|\bC[\s-]*USA\b/i], ["WCC", /\bWCC\b|west\s*coast/i],
  ["WAC", /\bWAC\b|western\s*athletic/i], ["Pac-12", /pac[\s-]*12/i], ["Sun Belt", /sun\s*belt/i],
  ["Horizon", /horizon/i], ["Ivy", /\bivy\b/i], ["Patriot", /patriot/i], ["Summit", /summit/i],
  ["Independientes", /independ|\bind\.?\s*(i-?a|d-?i)\b/i],
];
const ZONE = { east: "Este", west: "Oeste", north: "Norte", south: "Sur" };

function confName(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  for (const [name, re] of CONFS) if (re.test(t)) return name;
  return null;
}

function titleBefore(html, index) {
  const before = html.slice(Math.max(0, index - 3000), index);
  const re = /<(h[1-5]|caption|strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m, last = "";
  while ((m = re.exec(before))) last = decode(m[2]);
  return last;
}

function parseStandings(html) {
  const isHdr = (r) =>
    r.length >= 2 && r.some((c) => /pct|w-l|overall|record/i.test(c)) && !r.some((c) => /^\d+-\d+/.test(c));
  const tables = parseTables(html).filter((t) => t.rows.some(isHdr));
  const map = {};
  tables.forEach((t, ti) => {
    const hdr = t.rows.find(isHdr);
    const idx = (re, from = 0) => hdr.findIndex((c, i) => i >= from && re.test(c));
    let iT = idx(/^team$|^school$/i);
    if (iT < 0) iT = 0;
    const iRank = idx(/^rank$/i);
    const iPct = idx(/pct|%/i);
    const iStreak = idx(/streak|strk/i);

    const title = titleBefore(html, t.index);
    const plain = title.replace(/\b(standings|conference)\b/gi, "").replace(/\s+/g, " ").trim();
    const base = confName(hdr.join(" ")) || confName(title) || plain || `Conferencia ${ti + 1}`;
    let conf = base, pos = 0;
    for (const r of t.rows) {
      const label = isHdr(r) || r.length < 3 || r.every((c) => !/\d/.test(c));
      if (label) {
        const txt = r.join(" ");
        const c = confName(txt);
        const z = /\b(East|West|North|South)\b/i.exec(txt);
        if (c || z) { conf = (c || base) + (z && !c ? ` ${ZONE[z[1].toLowerCase()]}` : ""); pos = 0; }
        continue;
      }
      if (!r[iT]) continue;
      pos++;
      // Récord GENERAL = el récord de la fila con más partidos (el de conferencia siempre tiene menos)
      const best = r
        .map((c) => /^(\d+)-(\d+)(?:-(\d+))?$/.exec(c.trim()))
        .filter(Boolean)
        .map((m) => ({ txt: m[0], w: +m[1], l: +m[2], t: +(m[3] || 0) }))
        .map((x) => ({ ...x, g: x.w + x.l + x.t }))
        .sort((a, b) => b.g - a.g)[0];
      let pct = best && best.g ? (best.w + best.t / 2) / best.g : null;
      if (pct == null && iPct >= 0) {
        pct = num(r[iPct]);
        if (pct != null && pct > 1) pct = pct / 100;
      }
      map[key(cleanTeam(r[iT]))] = {
        team: r[iT], pos, div: conf,
        powerRank: iRank >= 0 ? num(r[iRank]) : null,
        record: best ? best.txt : "",
        pct,
        streak: iStreak >= 0 ? r[iStreak] : "",
      };
    }
  });
  if (!Object.keys(map).length) throw new Error("tabla de posiciones no encontrada");
  return map;
}

// ---------- estadísticas de equipo (Temporada, Last 3, Home, Away) ----------
function parseStat(html) {
  const isHdr = (r) => r.includes("Team") && r.includes("Home") && r.includes("Away");
  const t = parseTables(html).find((t) => t.rows.some(isHdr));
  if (!t) throw new Error("tabla de estadística no encontrada");
  const hdr = t.rows.find(isHdr);
  const iT = hdr.indexOf("Team"), iH = hdr.indexOf("Home"), iA = hdr.indexOf("Away"),
    iL3 = hdr.findIndex((c) => /last\s*3/i.test(c));
  let iS = hdr.findIndex((c, i) => i > iT && /^\d{4}$/.test(c));
  if (iS < 0) iS = iT + 1;

  const map = {};
  for (const r of t.rows) {
    if (isHdr(r) || !r[iT]) continue;
    map[key(cleanTeam(r[iT]))] = {
      season: num(r[iS]),
      last3: iL3 >= 0 ? num(r[iL3]) : null,
      home: num(r[iH]),
      away: num(r[iA]),
    };
  }
  return map;
}

// ---------- estadísticas de jugadores ----------
// Busca la tabla con columnas de jugador, equipo y valor. Si la cabecera no las nombra,
// las deduce del contenido (columna con nombres de personas, columna con equipos, última numérica).
const RE_PLAYER = /player|^name$|athlete/i;
const RE_TEAM = /team|school|college/i;
const RE_VALUE = /^value$|per\s*game|^avg|average|^ppg$|^apg$|^rpg$|^pts$|^ast$|^reb$|points|assists|rebounds/i;

function parsePlayers(html) {
  const tables = parseTables(html).filter((t) => t.rows.length >= 3);
  if (!tables.length) throw new Error("tabla de jugadores no encontrada");
  let best = null;
  for (const t of tables) {
    const hi = t.rows.findIndex((r) => r.some((c) => RE_PLAYER.test(c)) && r.some((c) => RE_TEAM.test(c)));
    let iP = -1, iT = -1, iV = -1, start = 0;
    if (hi >= 0) {
      const hdr = t.rows[hi];
      iP = hdr.findIndex((c) => RE_PLAYER.test(c));
      iT = hdr.findIndex((c, i) => i !== iP && RE_TEAM.test(c));
      iV = hdr.findIndex((c, i) => i !== iP && i !== iT && RE_VALUE.test(c));
      start = hi + 1;
    } else {
      // Deducción por contenido: texto sin dígitos en 2 columnas (jugador = la que tiene más palabras)
      const body = t.rows.filter((r) => r.length >= 3).slice(0, 30);
      if (body.length < 3) continue;
      const cols = Math.max(...body.map((r) => r.length));
      const textCols = [];
      for (let i = 0; i < cols; i++) {
        const vals = body.map((r) => r[i] || "");
        const txt = vals.filter((v) => /[a-z]/i.test(v) && !/\d/.test(v)).length;
        const avgLen = vals.reduce((n, v) => n + v.length, 0) / vals.length;
        // descarta columnas cortas tipo posición (G, F, C, G-F)
        if (txt >= body.length * 0.8 && avgLen > 3) textCols.push({ i, uniq: new Set(vals).size / vals.length });
      }
      if (textCols.length < 2) continue;
      // Jugador = la columna con más valores distintos (los equipos se repiten); empate = la primera
      textCols.sort((x, y) => y.uniq - x.uniq || x.i - y.i);
      iP = textCols[0].i; iT = textCols[1].i;
    }
    const byTeam = {};
    let n = 0;
    for (const r of t.rows.slice(start)) {
      if (!r[iP] || !r[iT] || RE_PLAYER.test(r[iP])) continue;
      let v = iV >= 0 ? num(r[iV]) : null;
      if (v == null) for (let i = r.length - 1; i >= 0; i--) { if (i === iP || i === iT) continue; v = num(r[i]); if (v != null) break; }
      if (v == null) continue;
      const tk = key(cleanTeam(r[iT]));
      (byTeam[tk] ||= {})[pkey(r[iP])] = { name: r[iP], team: r[iT], v };
      n++;
    }
    if (!best || n > best.n) best = { n, byTeam };
  }
  if (!best || !best.n) throw new Error("tabla de jugadores no encontrada");
  return best.byTeam;
}

// Las páginas de jugadores escriben el equipo con su apodo ("BYU Cougars", "Iowa State Cyclones",
// "North Carolina Tar Heels"). Se quita el apodo palabra por palabra desde el final hasta que el
// nombre coincide EXACTO con un equipo conocido; así "Iowa State Cyclones" nunca cae en "Iowa".
// Se quitan como máximo 2 palabras (el apodo: "Tar Heels", "Red Raiders"). Con más se corría el riesgo
// de que "Purdue Fort Wayne Mastodons" terminara como "Purdue".
function teamFromPlayerPage(raw, known) {
  const words = cleanTeam(raw).split(/\s+/).filter(Boolean);
  for (let drop = 0; drop <= 2 && drop < words.length; drop++) {
    const k = key(words.slice(0, words.length - drop).join(" "));
    if (known.has(k)) return { k, drop };
  }
  return null;
}

// Reagrupa las 3 tablas de jugadores por la clave de equipo del calendario.
// Si dos equipos distintos de la página de jugadores apuntan al mismo equipo, gana el que
// necesitó quitar menos palabras (el otro se descarta en vez de mezclar jugadores).
function remapAllPlayers(players, known) {
  const raws = new Map(); // nombre crudo -> {k, drop}
  for (const map of Object.values(players)) {
    if (!map) continue;
    for (const [rawKey, plist] of Object.entries(map)) {
      const team = Object.values(plist)[0].team;
      if (raws.has(team)) continue;
      raws.set(team, known.has(rawKey) ? { k: rawKey, drop: 0 } : teamFromPlayerPage(team, known));
    }
  }
  const bestDrop = {};
  for (const r of raws.values()) if (r) bestDrop[r.k] = Math.min(bestDrop[r.k] ?? 9, r.drop);
  const out = {};
  for (const [name, map] of Object.entries(players)) {
    if (!map) { out[name] = null; continue; }
    const m = {};
    for (const plist of Object.values(map)) {
      const r = raws.get(Object.values(plist)[0].team);
      if (!r || r.drop !== bestDrop[r.k]) continue;
      Object.assign((m[r.k] ||= {}), plist);
    }
    out[name] = m;
  }
  return out;
}

function topPlayers(players, teamName) {
  const tk = key(teamName);
  const byPts = players.pts?.[tk];
  if (!byPts) return null;
  return Object.entries(byPts)
    .sort((a, b) => b[1].v - a[1].v)
    .slice(0, TOP_PLAYERS)
    .map(([pk, p]) => ({
      name: p.name,
      team: p.team,
      pts: p.v,
      ast: players.ast?.[tk]?.[pk]?.v ?? null,
      reb: players.reb?.[tk]?.[pk]?.v ?? null,
    }));
}

// Diagnóstico: /api/ncaab?debug=team&slug=michigan-wolverines prueba posibles páginas de plantel
async function debugTeam(slug) {
  const base = `${SITE}/ncaa-basketball/team/${slug}`;
  const cands = ["", "/stats", "/players", "/player-stats", "/roster", "/leaders"];
  const out = {};
  await Promise.all(cands.map(async (c) => {
    const u = base + c;
    try {
      const r = await fetch(u, { headers: HEADERS, redirect: "follow" });
      const html = await r.text();
      const tables = parseTables(html);
      out[c || "/"] = {
        status: r.status, final: r.url, bytes: html.length, tables: tables.length,
        cabeceras: tables.map((t) => [t.rows.length, (t.rows[0] || []).slice(0, 8).join(" | "), (t.rows[1] || []).slice(0, 8).join(" | ")]),
        enlacesJugador: [...new Set((html.match(/href="[^"]*player[^"]*"/gi) || []).slice(0, 6))],
      };
    } catch (e) { out[c || "/"] = { error: e.message }; }
  }));
  return out;
}

// Diagnóstico: /api/ncaab?debug=players muestra cómo vienen las páginas de jugadores
async function debugPlayers() {
  const out = {};
  for (const [k, u] of Object.entries(PLAYER_STATS)) {
    try {
      const r = await fetch(u, { headers: HEADERS });
      const html = await r.text();
      const tables = parseTables(html);
      out[k] = {
        url: u, status: r.status, bytes: html.length, tables: tables.length,
        muestra: tables.slice(0, 4).map((t) => ({ filas: t.rows.length, primeras: t.rows.slice(0, 4) })),
        pistas: ["datatable", "tr-table", "json", "__NEXT_DATA__", "ajax", "player"].filter((w) => html.includes(w)),
      };
      try { const m = parsePlayers(html); out[k].equipos = Object.keys(m).length; out[k].ejemploEquipos = Object.keys(m).slice(0, 8); }
      catch (e) { out[k].error = e.message; }
    } catch (e) { out[k] = { url: u, error: e.message }; }
  }
  return out;
}

const find = (map, name) => (map ? map[key(name)] || null : null);

const json = (body, status, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extra },
  });

export default async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("debug") === "players")
    return json(await debugPlayers(), 200, { "Cache-Control": "no-store" });
  if (url.searchParams.get("debug") === "team")
    return json(await debugTeam((url.searchParams.get("slug") || "michigan-wolverines").replace(/[^a-z0-9-]/gi, "")), 200, { "Cache-Control": "no-store" });
  const date = url.searchParams.get("date");
  const validDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;

  const jobs = [
    ["schedule", `${SCHEDULE_URL}${validDate ? `?date=${validDate}` : ""}`],
    ["standings", STANDINGS_URL],
    ...STAT_KEYS.map((k) => [k, TEAM_STATS[k]]),
    ...Object.keys(PLAYER_STATS).map((k) => [`p_${k}`, PLAYER_STATS[k]]),
  ];
  const results = await Promise.allSettled(jobs.map(([k, u]) => getHtml(u, k !== "schedule")));

  const warnings = [];
  const html = {};
  results.forEach((r, i) => {
    if (r.status === "fulfilled") html[jobs[i][0]] = r.value;
    else warnings.push(`${jobs[i][0]}: ${r.reason?.message || r.reason}`);
  });

  if (!html.schedule) {
    return json(
      { ok: false, error: "No se pudo leer el calendario de TeamRankings.", warnings },
      502,
      { "Cache-Control": "no-store" }
    );
  }

  const safe = (label, fn, src) => {
    if (!src) return null;
    try { return fn(src); } catch (e) { warnings.push(`${label}: ${e.message}`); return null; }
  };

  const games = safe("schedule", parseSchedule, html.schedule) || [];
  const standings = safe("standings", parseStandings, html.standings);
  const stats = {};
  for (const k of STAT_KEYS) stats[k] = safe(k, parseStat, html[k]);
  const players = {};
  for (const k of Object.keys(PLAYER_STATS)) players[k] = safe(`p_${k}`, parsePlayers, html[`p_${k}`]);

  // Equipos conocidos (todas las tablas de equipos + posiciones + calendario) para reconocer apodos
  const known = new Set([
    ...STAT_KEYS.flatMap((k) => Object.keys(stats[k] || {})),
    ...Object.keys(standings || {}),
    ...games.flatMap((g) => [key(g.home), key(g.away)]),
  ]);
  const rawPlayerTeams = players.pts ? Object.keys(players.pts).length : 0;
  const samplePlayerTeams = players.pts ? Object.values(players.pts).slice(0, 3).map((m) => Object.values(m)[0].team) : [];
  Object.assign(players, remapAllPlayers(players, known));
  const warned = new Set();
  const noData = [];
  const team = (name) => {
    const t = { name, standing: find(standings, name) };
    for (const k of STAT_KEYS) t[k] = find(stats[k], name);
    t.players = topPlayers(players, name);
    const loaded = { standing: standings, ...stats };
    const missing = Object.keys(loaded).filter((k) => loaded[k] && !t[k]);
    if (missing.length && !warned.has(name)) {
      warned.add(name);
      if (stats.pts && missing.length === Object.keys(loaded).filter((k) => loaded[k]).length) noData.push(name);
      else warnings.push(`${name}: sin datos en ${missing.join(", ")}`);
    }
    return t;
  };

  const teams = {};
  for (const g of games) for (const n of [g.home, g.away]) if (!teams[n]) teams[n] = team(n);
  if (players.pts && games.length && !Object.values(teams).some((t) => t.players))
    warnings.push(`Jugadores: la tabla cargó (${rawPlayerTeams} equipos) pero ningún equipo de esta fecha aparece en ella. Ej.: ${samplePlayerTeams.join(", ")}`);
  const withoutPlayers = Object.values(teams).filter((t) => t.pts && !t.players).map((t) => t.name);
  if (players.pts && withoutPlayers.length && withoutPlayers.length < Object.keys(teams).length)
    warnings.push(`Sin jugadores en la lista de TeamRankings: ${withoutPlayers.sort().join(", ")}`);
  if (noData.length)
    warnings.push(`Sin estadísticas (normalmente equipos fuera de División I): ${noData.sort().join(", ")}`);

  return json(
    { ok: true, date: validDate, updated: new Date().toISOString(), games, teams, warnings },
    200,
    {
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Netlify-CDN-Cache-Control": "public, durable, s-maxage=900, stale-while-revalidate=3600",
      "Netlify-Vary": "query=date",
    }
  );
};

export const config = { path: "/api/ncaab" };
