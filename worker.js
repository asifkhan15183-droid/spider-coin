// =====================================================================
// SPIDER COIN (SPC) - Telegram Mini App
// Single-file Cloudflare Worker (frontend + backend) + D1 database
// Bindings: D1 "DB" | Secrets: BOT_TOKEN, WEBHOOK_SECRET | Optional var: ADMIN_ID
// =====================================================================
const MAIN_ADMIN = "8825348718", ADMIN_USER = "Spider_Incom", BOT_USER = "SPC_Wallet_bot";
const FOREVER = 4102444800000, SV = "4";
const DEF = { rate: 10, minc: 5, refrw: 200, secs: 30, prw: 9.23, wd: 0, minw: 1000, ch: "", dep: "", wl: "USDT BEP20 address", vp1: 2, vp2: 10, vc: 1e5, vr: 20, disc: 5, mins: 1000, srw: 100, sm: "", rmn: 7, rmh: 12, dtr: 15 };
const NK = ["rate", "minc", "refrw", "secs", "prw", "minw", "vp1", "vp2", "vc", "vr", "disc", "mins", "srw", "rmn", "rmh", "dtr"];
const PL = { 1: { c: 5e3, v: 500, q: 0 }, 2: { c: 1e4, v: 1000, q: 0 }, 3: { c: 2e4, v: 1000, q: 1 } };
const ADM = new Set(["al", "as", "at", "ae", "ad", "ap", "aw", "ao", "aa", "au", "ab", "ag"]);
const J = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const tg = async (env, m, b) => { try { const r = await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/" + m, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }); return await r.json() } catch (e) { return { ok: false } } };
let READY = false, CC = { t: 0, d: null }, LB = { t: 0, d: null };

// ---------------------------------------------------------------- schema
async function init(db) {
  if (READY) return;
  const v = await db.prepare("SELECT v FROM s WHERE k='_sv'").first().catch(() => null);
  if (!v || v.v !== SV) {
    await db.batch([
      db.prepare("CREATE TABLE IF NOT EXISTS u(id INTEGER PRIMARY KEY,n TEXT,r INTEGER DEFAULT 0,b REAL DEFAULT 0,m INTEGER DEFAULT 0,c INTEGER DEFAULT 0,p REAL DEFAULT 0,a INTEGER DEFAULT 0,un TEXT DEFAULT '',vl INTEGER DEFAULT 0,vx INTEGER DEFAULT 0,fm TEXT DEFAULT '',sl INTEGER DEFAULT 0,ss INTEGER DEFAULT 0,rc INTEGER DEFAULT 0,bn INTEGER DEFAULT 0,ts INTEGER DEFAULT 0,rg INTEGER DEFAULT 0)"),
      db.prepare("CREATE TABLE IF NOT EXISTS t(id INTEGER PRIMARY KEY AUTOINCREMENT,url TEXT,rw REAL,o INTEGER DEFAULT 0,l INTEGER DEFAULT 999999999,q INTEGER DEFAULT 0,st TEXT DEFAULT 'a',x TEXT)"),
      db.prepare("CREATE TABLE IF NOT EXISTS d(u INTEGER,t INTEGER,y TEXT,s INTEGER,c INTEGER DEFAULT 0,PRIMARY KEY(u,t,y))"),
      db.prepare("CREATE TABLE IF NOT EXISTS w(id INTEGER PRIMARY KEY AUTOINCREMENT,u INTEGER,amt REAL,ad TEXT,st TEXT DEFAULT 'p',ts INTEGER DEFAULT 0)"),
      db.prepare("CREATE TABLE IF NOT EXISTS s(k TEXT PRIMARY KEY,v TEXT)"),
      db.prepare("CREATE TABLE IF NOT EXISTS h(id INTEGER PRIMARY KEY AUTOINCREMENT,u INTEGER,k TEXT,amt REAL,ts INTEGER,n TEXT)"),
      db.prepare("CREATE TABLE IF NOT EXISTS o(id INTEGER PRIMARY KEY AUTOINCREMENT,u INTEGER,k TEXT,tx TEXT,st TEXT DEFAULT 'p',ex INTEGER DEFAULT 0,y TEXT)"),
      db.prepare("CREATE TABLE IF NOT EXISTS admins(id INTEGER PRIMARY KEY,by INTEGER DEFAULT 0,ts INTEGER DEFAULT 0)"),
      db.prepare("CREATE TABLE IF NOT EXISTS mining(u INTEGER PRIMARY KEY,st INTEGER DEFAULT 0)"),
      db.prepare("CREATE TABLE IF NOT EXISTS refs(referred INTEGER PRIMARY KEY,referrer INTEGER,rw REAL DEFAULT 0,ts INTEGER DEFAULT 0)"),
      db.prepare("CREATE TABLE IF NOT EXISTS txs(tx TEXT PRIMARY KEY,k TEXT,u INTEGER,ts INTEGER DEFAULT 0)")]);
    const addCols = async (tbl, list) => {
      const cols = ((await db.prepare("PRAGMA table_info(" + tbl + ")").all()).results || []).map(r => r.name);
      for (const [n, t] of list) if (!cols.includes(n)) { try { await db.prepare("ALTER TABLE " + tbl + " ADD COLUMN " + n + " " + t).run() } catch (e) { } }
    };
    await addCols("u", [["un", "TEXT DEFAULT ''"], ["vl", "INTEGER DEFAULT 0"], ["vx", "INTEGER DEFAULT 0"], ["fm", "TEXT DEFAULT ''"], ["sl", "INTEGER DEFAULT 0"], ["ss", "INTEGER DEFAULT 0"], ["rc", "INTEGER DEFAULT 0"], ["bn", "INTEGER DEFAULT 0"], ["ts", "INTEGER DEFAULT 0"], ["rg", "INTEGER DEFAULT 0"]]);
    await addCols("w", [["ts", "INTEGER DEFAULT 0"]]);
    await db.batch([
      db.prepare("CREATE INDEX IF NOT EXISTS hu ON h(u,id)"),
      db.prepare("CREATE INDEX IF NOT EXISTS uun ON u(un)"),
      db.prepare("CREATE INDEX IF NOT EXISTS ur ON u(r)"),
      db.prepare("CREATE INDEX IF NOT EXISTS rr ON refs(referrer)"),
      db.prepare("CREATE INDEX IF NOT EXISTS ts_ ON t(st,o,id)"),
      db.prepare("CREATE INDEX IF NOT EXISTS wst ON w(st,id)"),
      db.prepare("CREATE INDEX IF NOT EXISTS ost ON o(st,k,y)"),
      db.prepare("INSERT OR IGNORE INTO admins(id,by,ts) SELECT id,0,0 FROM u WHERE a=1"),
      db.prepare("INSERT OR IGNORE INTO mining(u,st) SELECT id,m FROM u WHERE m>0"),
      db.prepare("INSERT OR IGNORE INTO refs(referred,referrer,rw,ts) SELECT id,r,0,0 FROM u WHERE r>0 AND c=1"),
      db.prepare("INSERT OR IGNORE INTO txs(tx,k,u,ts) SELECT lower(tx),k,u,0 FROM o WHERE tx IS NOT NULL AND tx!=''"),
      db.prepare("INSERT OR IGNORE INTO txs(tx,k,u,ts) SELECT lower(substr(x,instr(x,'|')+1)),'promo',o,0 FROM t WHERE x LIKE '%|%'"),
      db.prepare("INSERT OR REPLACE INTO s(k,v) VALUES('_sv',?)").bind(SV)]);
  }
  READY = true;
}

// ---------------------------------------------------------------- Telegram initData verification
async function ver(IP, tok) {
  try {
    const h = IP.get("hash"); if (!h || !tok) return null; IP.delete("hash");
    const ad = +IP.get("auth_date"); if (!ad || Date.now() / 1e3 - ad > 172800) return null;
    const dc = [...IP.entries()].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0).map(([k, v]) => k + "=" + v).join("\n");
    const E = new TextEncoder(), hm = async (k, m) => new Uint8Array(await crypto.subtle.sign("HMAC", await crypto.subtle.importKey("raw", k, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), E.encode(m)));
    const sg = await hm(await hm(E.encode("WebAppData"), tok), dc);
    const hx = [...sg].map(b => b.toString(16).padStart(2, "0")).join("");
    if (hx.length !== h.length) return null;
    let d = 0; for (let i = 0; i < hx.length; i++) d |= hx.charCodeAt(i) ^ h.charCodeAt(i);
    if (d) return null;
    const u = JSON.parse(IP.get("user"));
    return u && Number.isInteger(u.id) && u.id > 0 ? u : null;
  } catch (e) { return null }
}

async function getC(db, fresh) {
  const n = Date.now(); if (!fresh && CC.d && n - CC.t < 2e4) return CC.d;
  const c = { ...DEF };
  ((await db.prepare("SELECT k,v FROM s").all()).results || []).forEach(r => { if (Object.prototype.hasOwnProperty.call(DEF, r.k)) c[r.k] = r.v });
  CC = { t: n, d: c }; return c;
}
const chs = s => String(s || "").split(",").map(x => x.trim()).filter(Boolean);

// ---------------------------------------------------------------- router
export default {
  async fetch(rq, env) {
    try {
      const U = new URL(rq.url), db = env.DB;
      if (U.pathname == "/webhook" && rq.method == "POST") {
        if (!env.WEBHOOK_SECRET || rq.headers.get("x-telegram-bot-api-secret-token") !== env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
        let up; try { up = await rq.json() } catch (e) { return new Response("ok") }
        const m = up.message;
        if (m && m.text && m.from && m.chat && m.chat.type == "private" && /^\/start(@\w+)?(\s|$)/.test(m.text)) {
          await init(db);
          const prm = m.text.split(/\s+/)[1] || ""; let r = /^r[0-9]{1,15}$/.test(prm) ? +prm.slice(1) : 0;
          if (r && (r == m.from.id || !(await db.prepare("SELECT id FROM u WHERE id=?").bind(r).first()))) r = 0;
          await db.batch([
            db.prepare("INSERT OR IGNORE INTO u(id,n,r,ts) VALUES(?,?,?,?)").bind(m.from.id, String(m.from.first_name || "User").slice(0, 64), r, Date.now()),
            db.prepare("UPDATE u SET r=? WHERE id=? AND r=0 AND rg=0 AND ?>0").bind(r, m.from.id, r)]);
          await tg(env, "sendMessage", { chat_id: m.chat.id, text: "🕷 Welcome to Spider Coin! Mine, complete tasks and invite friends.", reply_markup: { inline_keyboard: [[{ text: "🕸 Open App", web_app: { url: U.origin + "/app" } }]] } });
        }
        return new Response("ok");
      }
      if (U.pathname == "/api" && rq.method == "POST") return await run(rq, env);
      return new Response(HTML.replace("{{AU}}", ADMIN_USER), { headers: { "content-type": "text/html;charset=UTF-8", "cache-control": "no-store" } });
    } catch (e) { return J({ e: "Server error. Please try again." }, 500) }
  }
};

// ---------------------------------------------------------------- API
async function run(rq, env) {
  let q; try { q = await rq.json() } catch (e) { return J({ e: "Bad request" }, 400) }
  if (!q || typeof q.a !== "string" || typeof q.i !== "string") return J({ e: "Bad request" }, 400);
  const db = env.DB; if (!db || !env.BOT_TOKEN) return J({ e: "Server is not configured" }, 500);
  const IP = new URLSearchParams(q.i), us = await ver(IP, env.BOT_TOKEN);
  if (!us) return J({ e: "Open the app from Telegram" }, 401);
  await init(db);
  const a = q.a, id = us.id, now = Date.now(), today = new Date(now).toISOString().slice(0, 10), MAIN = String(env.ADMIN_ID || MAIN_ADMIN);
  const P = (s, ...p) => db.prepare(s).bind(...p), X = (s, ...p) => P(s, ...p).run(), Q = (s, ...p) => P(s, ...p).first(),
    E = e => J({ e }),
    HS = (w, k, m, n, g, gb) => P("INSERT INTO h(u,k,amt,ts,n) SELECT ?,?,?,?,? WHERE " + g, w, k, m, now, n || "", ...gb);
  const c = await getC(db, a == "wd" || ADM.has(a)), N = k => +c[k];
  const SEL = "SELECT u.*,COALESCE((SELECT st FROM mining WHERE u=u.id),0) mst,EXISTS(SELECT 1 FROM admins WHERE id=u.id) isa FROM u WHERE u.id=?";
  const un = (us.username || "").toLowerCase(), nm = String(us.first_name || "User").slice(0, 64);
  const sp = IP.get("start_param") || "";
  const rr = async () => { const r = /^r[0-9]{1,15}$/.test(sp) ? +sp.slice(1) : 0; return r && r != id && await Q("SELECT id FROM u WHERE id=?", r) ? r : 0 };
  let u = await Q(SEL, id);
  if (!u) { await X("INSERT OR IGNORE INTO u(id,n,r,ts,rg) VALUES(?,?,?,?,1)", id, nm, await rr(), now); u = await Q(SEL, id) }
  else if (!u.rg && !u.r) { const r0 = await rr(); if (r0) { await X("UPDATE u SET r=? WHERE id=?", r0, id); u.r = r0 } }
  if ((u.un || "") !== un || u.n !== nm || !u.rg) {
    const st = []; if (un) st.push(P("UPDATE u SET un='' WHERE un=? AND id!=?", un, id));
    st.push(P("UPDATE u SET un=?,n=?,rg=1 WHERE id=?", un, nm, id)); await db.batch(st); u.un = un; u.n = nm; u.rg = 1;
  }
  const adm = String(id) == MAIN || u.isa == 1;
  if (u.bn && !adm) return E("Your account is blocked");
  const lv = u.vx > now ? u.vl : 0, er = lv ? N("vr") : N("rate");

  if (a == "hi") return J({ h: (await P("SELECT k,amt,ts,n FROM h WHERE u=? ORDER BY id DESC LIMIT 50", id).all()).results });
  if (a == "lb") {
    if (!LB.d || now - LB.t > 6e4) {
      const r = await db.batch([P("SELECT id,n,un,b,rc,IIF(vx>?,vl,0) lv FROM u WHERE bn=0 ORDER BY lv DESC,rc DESC,b DESC LIMIT 100", now),
        P("SELECT o.u id,u.n,u.un FROM o JOIN u ON u.id=o.u WHERE o.k='rm' AND o.st='a' AND o.ex>? ORDER BY o.id DESC LIMIT 50", now)]);
      LB = { t: now, d: { lb: r[0].results, rm: r[1].results } };
    }
    return J(LB.d);
  }

  // ------------------------------------------------------------ admin
  if (ADM.has(a)) {
    if (!adm) return E("No access");
    const OK = String(q.ok) == "1", ON = String(q.on) == "1", tid = Math.floor(+q.id);
    const find = async s => { s = String(s || "").trim().replace(/^@/, "").toLowerCase(); if (!s) return null; const f = "SELECT id,n,un,b,bn,EXISTS(SELECT 1 FROM admins WHERE id=u.id) isa FROM u WHERE "; return /^[0-9]+$/.test(s) ? Q(f + "id=?", +s) : Q(f + "un=?", s) };
    let usr = null;
    switch (a) {
      case "al": break;
      case "as": {
        const o = {};
        for (const k of NK) if (q[k] !== undefined && q[k] !== "") { const v = Number(q[k]); if (!Number.isFinite(v) || v < 0) return E("Invalid value: " + k); o[k] = v }
        if (o.secs !== undefined && o.secs < 30) return E("Task wait time must be at least 30 seconds");
        for (const k of ["minc", "minw", "mins"]) if (o[k] !== undefined && !(o[k] > 0)) return E(k + " must be above 0");
        if (o.disc > 100) return E("Discount max 100");
        if (o.rmn !== undefined) o.rmn = Math.floor(o.rmn);
        if (q.wd !== undefined) { if (!["0", "1"].includes(String(q.wd).trim())) return E("Withdraw must be 0 or 1"); o.wd = +q.wd }
        if (q.ch !== undefined) { const L = chs(q.ch); if (L.some(x => !/^(@[A-Za-z][A-Za-z0-9_]{3,31}|-100[0-9]{5,})$/.test(x))) return E("Invalid channel list"); o.ch = L.join(",") }
        if (q.dep !== undefined) { const v = String(q.dep).trim(); if (v && !/^0x[a-fA-F0-9]{40}$/.test(v)) return E("Invalid deposit address"); o.dep = v }
        if (q.wl !== undefined) o.wl = String(q.wl).slice(0, 60);
        if (q.sm !== undefined) { const v = String(q.sm).trim(); if (v && !/^https:[/][/]/.test(v)) return E("Story image must be https"); o.sm = v.slice(0, 500) }
        const ks = Object.keys(o); if (ks.length) await db.batch(ks.map(k => P("INSERT OR REPLACE INTO s(k,v) VALUES(?,?)", k, String(o[k]))));
        CC.d = null; break;
      }
      case "at": {
        const n = await Q("SELECT COUNT(*) n FROM t WHERE o=0 AND st='a'"); if (n.n >= 10) return E("Max 10 daily tasks");
        const url = String(q.url || "").trim(), rw = q.rw === "" || q.rw === undefined ? N("dtr") : +q.rw;
        if (!/^https:[/][/]\S{3,480}$/.test(url) || !(rw > 0)) return E("Valid https link and reward needed");
        await X("INSERT INTO t(url,rw) VALUES(?,?)", url, rw); break;
      }
      case "ae": {
        const url = String(q.url || "").trim(), rw = +q.rw;
        if (!/^https:[/][/]\S{3,480}$/.test(url) || !(rw > 0)) return E("Valid https link and reward needed");
        await X("UPDATE t SET url=?,rw=? WHERE id=? AND o=0 AND st='a'", url, rw, tid); break;
      }
      case "ad": await X("UPDATE t SET st='x' WHERE id=?", tid); break;
      case "ap": await X("UPDATE t SET st=? WHERE id=? AND st='p'", OK ? "a" : "x", tid); break;
      case "aw": {
        const w = await Q("SELECT * FROM w WHERE id=? AND st='p'", tid); if (!w) return E("Already processed");
        if (OK) { const r = await X("UPDATE w SET st='d' WHERE id=? AND st='p'", w.id); if (!r.meta.changes) return E("Already processed") }
        else {
          const g = "EXISTS(SELECT 1 FROM w WHERE id=? AND st='p')";
          const r = await db.batch([HS(w.u, "refund", w.amt, "Withdraw rejected", g, [w.id]), P("UPDATE u SET b=ROUND(b+?,6) WHERE id=? AND " + g, w.amt, w.u, w.id), P("UPDATE w SET st='r' WHERE id=? AND st='p'", w.id)]);
          if (r[1].meta.changes != 1) return E("Already processed");
        }
        await tg(env, "sendMessage", { chat_id: w.u, text: OK ? "✅ Your withdrawal of " + w.amt + " SPC was approved. The payout is sent manually by the admin." : "❌ Your withdrawal was rejected and " + w.amt + " SPC was refunded to your wallet." });
        break;
      }
      case "ao": {
        const o = await Q("SELECT * FROM o WHERE id=? AND st='p'", tid); if (!o) return E("Already processed");
        if (!OK) await X("UPDATE o SET st='x' WHERE id=? AND st='p'", o.id);
        else if (o.k == "rm") await X("UPDATE o SET st='a',ex=? WHERE id=? AND st='p'", now + N("rmh") * 36e5, o.id);
        else {
          const g = "EXISTS(SELECT 1 FROM o WHERE id=? AND st='p')";
          await db.batch([P("UPDATE u SET vl=MAX(CASE WHEN vx>? THEN vl ELSE 0 END,?),vx=? WHERE id=? AND " + g, now, o.k == "v2" ? 2 : 1, FOREVER, o.u, o.id), P("UPDATE o SET st='a' WHERE id=? AND st='p'", o.id)]);
        }
        break;
      }
      case "aa": {
        if (!(tid > 0)) return E("Enter a numeric Telegram ID");
        if (String(tid) == MAIN) return E("Main admin cannot be changed");
        if (ON) await X("INSERT OR IGNORE INTO admins(id,by,ts) VALUES(?,?,?)", tid, id, now); else await X("DELETE FROM admins WHERE id=?", tid);
        break;
      }
      case "au": usr = await find(q.s); if (!usr) return E("User not found"); break;
      case "ab": {
        const t = await find(String(tid)); if (!t) return E("User not found");
        if (String(t.id) == MAIN || t.isa) return E("Admins cannot be blocked");
        await X("UPDATE u SET bn=? WHERE id=?", ON ? 1 : 0, t.id); usr = await find(String(t.id)); break;
      }
      case "ag": {
        const t = await find(String(tid)); if (!t) return E("User not found");
        const m = Math.round(Number(q.amt) * 1e6) / 1e6; if (!Number.isFinite(m) || m == 0 || Math.abs(m) > 1e9) return E("Enter a valid amount");
        const g = m > 0 ? "EXISTS(SELECT 1 FROM u WHERE id=?)" : "(SELECT b FROM u WHERE id=?)>=?", gb = m > 0 ? [t.id] : [t.id, -m];
        const r = await db.batch([HS(t.id, "admin", m, "Admin", g, gb), P("UPDATE u SET b=ROUND(b+?,6) WHERE id=? AND " + g, m, t.id, ...gb)]);
        if (r[1].meta.changes != 1) return E("User balance is too low"); usr = await find(String(t.id)); break;
      }
    }
    const r = await db.batch([
      P("SELECT * FROM t WHERE st IN('a','p') ORDER BY st DESC,id DESC LIMIT 80"),
      P("SELECT w.*,IIF(u.vx>?,u.vl,0) lv FROM w JOIN u ON u.id=w.u WHERE w.st='p' ORDER BY lv DESC,w.id LIMIT 100", now),
      P("SELECT * FROM o WHERE st='p' ORDER BY id LIMIT 100"),
      P("SELECT id FROM admins ORDER BY id"),
      P("SELECT COUNT(*) n FROM u")]);
    return J({ c: await getC(db, true), tk: r[0].results, w: r[1].results, od: r[2].results, ad: r[3].results, n: r[4].results[0].n, main: MAIN, usr });
  }

  // ------------------------------------------------------------ user actions
  switch (a) {
    case "me": break;
    case "ms": await db.batch([P("INSERT OR IGNORE INTO mining(u,st) VALUES(?,0)", id), P("UPDATE mining SET st=? WHERE u=? AND st=0", now, id)]); break;
    case "mc": {
      if (!u.mst) return E("Start mining first");
      const m = Math.floor(Math.min(now - u.mst, 864e5) * er / 864e5 * 1e6) / 1e6;
      if (!(m >= N("minc"))) return E("Minimum claim " + c.minc + " SPC");
      const g = "(SELECT st FROM mining WHERE u=?)=?", gb = [id, u.mst];
      const r = await db.batch([HS(id, "mc", m, "", g, gb), P("UPDATE u SET b=ROUND(b+?,6) WHERE id=? AND " + g, m, id, ...gb), P("UPDATE mining SET st=0 WHERE u=? AND st=?", id, u.mst)]);
      if (r[1].meta.changes != 1) return E("Already claimed");
      break;
    }
    case "ts": case "tc": {
      const t = await Q("SELECT * FROM t WHERE id=? AND st='a'", +q.t); if (!t) return E("Task closed");
      if (t.o == id) return E("You cannot claim your own promo");
      const yy = t.q ? "0" : today;
      if (a == "ts") { await X("INSERT OR IGNORE INTO d(u,t,y,s) VALUES(?,?,?,?)", id, t.id, yy, now); break }
      const k = await Q("SELECT s,c FROM d WHERE u=? AND t=? AND y=?", id, t.id, yy);
      if (!k) return E("Visit the link first"); if (k.c) return E("Already claimed");
      if (now - k.s < N("secs") * 1e3) return E("Wait " + Math.ceil(N("secs") - (now - k.s) / 1e3) + "s");
      const g = "EXISTS(SELECT 1 FROM d WHERE u=? AND t=? AND y=? AND c=0)", gb = [id, t.id, yy];
      const st = [HS(id, "task", t.rw, "", g, gb), P("UPDATE u SET b=ROUND(b+?,6) WHERE id=? AND " + g, t.rw, id, ...gb)];
      if (t.o) st.push(P("UPDATE t SET l=l-1,st=IIF(l<=1,'x','a') WHERE id=? AND " + g, t.id, ...gb));
      st.push(P("UPDATE d SET c=1 WHERE u=? AND t=? AND y=? AND c=0", ...gb));
      const r = await db.batch(st); if (r[1].meta.changes != 1) return E("Already claimed");
      break;
    }
    case "ck": {
      if (u.c) return E("Already verified");
      for (const x of chs(c.ch)) {
        const r = await tg(env, "getChatMember", { chat_id: x, user_id: id });
        if (!r || !r.ok) return E("Cannot verify " + x + " (the bot must be admin there)");
        const s = r.result.status; if (s == "left" || s == "kicked" || (s == "restricted" && !r.result.is_member)) return E("Join all channels first");
      }
      const ref = u.r && u.r != id ? await Q("SELECT id FROM u WHERE id=?", u.r) : null, g = "(SELECT c FROM u WHERE id=?)=0", st = [];
      if (ref) { st.push(P("INSERT OR IGNORE INTO refs(referred,referrer,rw,ts) SELECT ?,?,?,? WHERE " + g, id, ref.id, N("refrw"), now, id)); st.push(P("UPDATE u SET p=ROUND(p+?,6),rc=rc+1 WHERE id=? AND " + g, N("refrw"), ref.id, id)) }
      st.push(P("UPDATE u SET c=1 WHERE id=? AND c=0", id)); await db.batch(st);
      break;
    }
    case "rc": {
      const p = +u.p; if (!(p > 0)) return E("Nothing to claim");
      const g = "(SELECT p FROM u WHERE id=?)>=?";
      const r = await db.batch([HS(id, "referral", p, "", g, [id, p]), P("UPDATE u SET b=ROUND(b+?,6),p=ROUND(p-?,6) WHERE id=? AND " + g, p, p, id, id, p)]);
      if (r[1].meta.changes != 1) return E("Try again"); break;
    }
    case "pr": {
      const pay = q.pay, pl = PL[pay == "f" ? 2 : +q.p], url = String(q.url || "").trim();
      if (!pl || !/^https:[/][/]\S{3,480}$/.test(url)) return E("Enter a valid https link");
      const ti = (tx, g, gb) => P("INSERT INTO t(url,rw,o,l,q,st,x) SELECT ?,?,?,?,?,?,? WHERE " + g, url, N("prw"), id, pl.v, pl.q, tx ? "p" : "a", tx ? (+q.p + "|" + tx) : "", ...gb);
      if (pay == "f") {
        if (lv < 2) return E("Free monthly promo is for VVIP only");
        const mk = today.slice(0, 7), g = "COALESCE((SELECT fm FROM u WHERE id=?),'')!=?", gb = [id, mk];
        const r = await db.batch([ti("", g, gb), P("UPDATE u SET fm=? WHERE id=? AND " + g, mk, id, ...gb)]);
        if (r[0].meta.changes != 1) return E("Free monthly promo already used");
      } else if (pay == "c") {
        const k = Math.round(pl.c * (lv ? 1 - N("disc") / 100 : 1)), g = "(SELECT b FROM u WHERE id=?)>=?", gb = [id, k];
        const r = await db.batch([HS(id, "promo", -k, "", g, gb), ti("", g, gb), P("UPDATE u SET b=ROUND(b-?,6) WHERE id=? AND " + g, k, id, ...gb)]);
        if (r[2].meta.changes != 1) return E("Not enough coins");
      } else if (pay == "u") {
        const tx = String(q.tx || "").trim().toLowerCase(); if (!/^0x[0-9a-f]{64}$/.test(tx)) return E("Enter a valid USDT TX hash");
        const r = await db.batch([ti(tx, "NOT EXISTS(SELECT 1 FROM txs WHERE tx=?)", [tx]), P("INSERT OR IGNORE INTO txs(tx,k,u,ts) VALUES(?,?,?,?)", tx, "promo", id, now)]);
        if (r[0].meta.changes != 1) return E("This TX hash was already used");
      } else return E("Choose a payment method");
      break;
    }
    case "wd": {
      if (String(c.wd) != "1") return E("Withdrawal Start in 2027");
      const m = Math.round(+q.amt * 1e6) / 1e6, ad = String(q.ad || "").trim();
      if (!(m >= N("minw"))) return E("Minimum withdraw " + c.minw);
      if (!/^0x[a-fA-F0-9]{40}$/.test(ad)) return E("Enter a valid BEP20 address (0x...)");
      const g = "(SELECT b FROM u WHERE id=?)>=?", gb = [id, m];
      const r = await db.batch([HS(id, "withdraw", -m, ad.slice(0, 8) + "…", g, gb), P("INSERT INTO w(u,amt,ad,ts) SELECT ?,?,?,? WHERE " + g, id, m, ad, now, ...gb), P("UPDATE u SET b=ROUND(b-?,6) WHERE id=? AND " + g, m, id, ...gb)]);
      if (r[2].meta.changes != 1) return E("Not enough coins"); break;
    }
    case "sd": {
      const m = Math.round(+q.amt * 1e6) / 1e6, to = String(q.to || "").replace(/^@/, "").trim().toLowerCase();
      if (!(m > 0 && m >= N("mins"))) return E("Minimum send " + c.mins);
      if (!/^[a-z0-9_]{4,32}$/.test(to)) return E("Enter a valid @username");
      const v = await Q("SELECT id FROM u WHERE un=?", to);
      if (!v) return E("User not found (they must open the app once)");
      if (v.id == id) return E("You cannot send to yourself");
      const g = "(SELECT b FROM u WHERE id=?)>=?", gb = [id, m];
      const r = await db.batch([HS(id, "sent", -m, "@" + to, g, gb), HS(v.id, "received", m, "@" + (un || id), g, gb),
        P("UPDATE u SET b=CASE WHEN id=? THEN ROUND(b-?,6) ELSE ROUND(b+?,6) END WHERE id IN (?,?) AND " + g, id, m, m, id, v.id, ...gb)]);
      if (r[2].meta.changes != 2) return E("Not enough coins"); break;
    }
    case "bv": {
      if (lv > 0) return E("You already have a VIP badge");
      const k = N("vc"), g = "(SELECT b FROM u WHERE id=?)>=?", gb = [id, k];
      const r = await db.batch([HS(id, "vip", -k, "VIP", g, gb), P("UPDATE u SET b=ROUND(b-?,6),vl=1,vx=? WHERE id=? AND " + g, k, FOREVER, id, ...gb)]);
      if (r[1].meta.changes != 1) return E("Not enough coins"); break;
    }
    case "vo": {
      const k = q.k, tx = String(q.tx || "").trim().toLowerCase();
      if (!["v1", "v2", "rm"].includes(k)) return E("Invalid order");
      if (!/^0x[0-9a-f]{64}$/.test(tx)) return E("Enter a valid USDT TX hash (0x + 64 hex)");
      if ((k == "v1" && lv > 0) || (k == "v2" && lv > 1)) return E("You already have this badge");
      if (k == "rm" && (await Q("SELECT COUNT(*) n FROM o WHERE k='rm' AND y=? AND st IN('p','a')", today)).n >= N("rmn")) return E("Today's slots are full");
      const r = await db.batch([P("INSERT INTO o(u,k,tx,y) SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM txs WHERE tx=?)", id, k, tx, today, tx), P("INSERT OR IGNORE INTO txs(tx,k,u,ts) VALUES(?,?,?,?)", tx, k, id, now)]);
      if (r[0].meta.changes != 1) return E("This TX hash was already used"); break;
    }
    case "ss": {
      if (!c.sm) return E("Story task is not ready yet"); if (now - u.sl < 6048e5) return E("Available once every 7 days");
      await X("UPDATE u SET ss=? WHERE id=?", now, id); break;
    }
    case "sc": {
      if (!u.ss || now - u.ss < N("secs") * 1e3 || now - u.sl < 6048e5) return E("Post the story first");
      const g = "(SELECT ss FROM u WHERE id=?)=?", gb = [id, u.ss];
      const r = await db.batch([HS(id, "story", N("srw"), "", g, gb), P("UPDATE u SET b=ROUND(b+?,6),sl=?,ss=0 WHERE id=? AND " + g, N("srw"), now, id, ...gb)]);
      if (r[1].meta.changes != 1) return E("Already claimed"); break;
    }
    default: return E("Unknown action");
  }
  const r = await db.batch([P(SEL, id),
    P("SELECT t.id,t.url,t.rw,t.o,t.q,d.s,d.c dc FROM t LEFT JOIN d ON d.u=? AND d.t=t.id AND d.y=IIF(t.q=1,'0',?) WHERE t.st='a' AND t.o!=? AND NOT (t.o>0 AND d.c=1) ORDER BY t.o,t.id LIMIT 40", id, today, id),
    P("SELECT COUNT(*) n FROM refs WHERE referrer=?", id)]);
  u = r[0].results[0]; const l2 = u.vx > Date.now() ? u.vl : 0;
  return J({ u: { id: u.id, n: u.n, un: u.un, b: u.b, p: u.p, c: u.c, r: u.r, sl: u.sl, ss: u.ss, mst: u.mst }, c, tk: r[1].results, rf: r[2].results[0].n, bot: BOT_USER, now: Date.now(), adm, lv: l2, er: l2 ? N("vr") : N("rate") });
}

// ---------------------------------------------------------------- frontend
const HTML = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover">
<script src="https://telegram.org/js/telegram-web-app.js"></script><title>Spider Coin</title>
<style>
:root{--a:#39ff88;--bg:#070d0a;--cd:#0e1813;--ln:#1d3a2b;--mu:#7fa592;--rd:#ff5470}
*{box-sizing:border-box;margin:0;-webkit-tap-highlight-color:transparent}
html{background:var(--bg)}
body{font:14px/1.4 system-ui,sans-serif;background:var(--bg);color:#e6fff0;padding:0 12px 90px;min-height:100vh;max-width:480px;margin:0 auto;background-image:repeating-conic-gradient(from 0deg at 50% 0,rgba(57,255,136,.045) 0 1deg,transparent 1deg 14deg),repeating-radial-gradient(circle at 50% 0,rgba(57,255,136,.045) 0 1px,transparent 1px 44px);background-attachment:fixed}
.g{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(145px,1fr))}
.c{background:var(--cd);border:1px solid var(--ln);border-radius:14px;padding:14px;margin-bottom:10px}
.b{width:100%;padding:12px;border:0;border-radius:10px;background:var(--a);color:#03140a;font-weight:800;font-size:15px;margin-top:4px;transition:transform .1s}
.b:active{transform:scale(.97)}.b:disabled{background:#1d3a2b;color:var(--mu)}
.b.x{background:var(--rd);color:#fff}
input,select{width:100%;padding:11px;margin:5px 0;border-radius:10px;border:1px solid var(--ln);background:var(--bg);color:#e6fff0;font-size:16px}
nav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:480px;display:grid;grid-auto-flow:column;grid-auto-columns:1fr;background:#09130e;border-top:1px solid var(--ln);padding:6px 2px calc(6px + env(safe-area-inset-bottom))}
nav a{display:flex;flex-direction:column;align-items:center;gap:3px;padding:7px 0;font-size:11px;color:var(--mu)}nav a.on{color:var(--a)}
.big{font-size:clamp(28px,9vw,42px);font-weight:800;color:var(--a);font-variant-numeric:tabular-nums;letter-spacing:1px;margin:6px 0;text-shadow:0 0 18px rgba(57,255,136,.35)}
.m{color:var(--mu);font-size:12px}h3{margin:14px 0 8px}
header{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:10px;height:56px;margin:0 -12px;padding:0 12px;background:var(--bg);border-bottom:1px solid var(--ln)}
.av{flex:none;width:40px;height:40px;border-radius:50%;background:var(--a);color:#03140a;display:grid;place-items:center;font-weight:800}
.tt{flex:1;min-width:0;display:flex;flex-direction:column}.tt b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tt span{font-size:12px;color:var(--mu)}
.pill{padding:6px 12px;border:1px solid var(--ln);border-radius:18px;font-weight:700;flex:none;font-variant-numeric:tabular-nums;color:var(--a)}.pg{padding-top:12px}
.cs{display:flex;justify-content:center;gap:6px;height:78px}.cn{animation:fl 2.4s ease-in-out infinite}.cn:nth-child(2){animation-delay:.4s}.cn:nth-child(3){animation-delay:.8s}@keyframes fl{50%{transform:translateY(-8px) rotate(6deg)}}
.pl{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--a);margin-right:6px;animation:pl 1.2s infinite}@keyframes pl{50%{opacity:.25;transform:scale(1.6)}}
.pb{height:6px;border-radius:3px;background:var(--ln);margin:6px 0 8px;overflow:hidden}.pb i{display:block;height:6px;width:0;background:var(--a);transition:width .2s}
.fi{animation:fi .22s}@keyframes fi{from{opacity:0;transform:translateY(8px)}}
#ts{position:fixed;top:64px;left:50%;transform:translate(-50%,-16px);background:#10241a;border:1px solid var(--ln);padding:10px 16px;border-radius:20px;opacity:0;transition:.25s;pointer-events:none;z-index:9;font-weight:700;max-width:92%;text-align:center}#ts.on{opacity:1;transform:translate(-50%,0)}
.r{display:flex;justify-content:space-between;gap:8px;align-items:center;word-break:break-all;padding:6px 0}.r .b{width:auto;padding:8px 12px;font-size:13px;margin:0}
@media(prefers-reduced-motion:reduce){*{animation:none!important}}
</style></head><body><div id="app"><p class="m" style="padding:40px;text-align:center">Loading…</p></div><div id="ts"></div><nav id="nav"></nav>
<script>
const T=Telegram.WebApp,$=s=>document.getElementById(s);T.ready();T.expand();try{T.setHeaderColor('#070d0a');T.setBackgroundColor('#070d0a')}catch(e){}
const ADM=['al','as','at','ae','ad','ap','aw','ao','aa','au','ab','ag'];
let S,off=0,tab='h',AD=0,pb=null,HI=null,BD=null;
const CN='<svg class="cn" viewBox="0 0 64 64" width="64" height="64"><circle cx="32" cy="32" r="29" fill="#39ff88"/><circle cx="32" cy="32" r="23" fill="none" stroke="#03140a" stroke-opacity=".5" stroke-width="2"/><path d="M32 16v32M20 22l24 20M44 22L20 42" stroke="#03140a" stroke-width="2.5" stroke-linecap="round"/></svg>';
const toast=m=>{const e=$('ts');e.textContent=m;e.className='on';clearTimeout(toast.t);toast.t=setTimeout(()=>{e.className=''},2600)};
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';'),f=n=>(+n).toFixed(2),host=u=>String(u).replace(/^https?:[/][/]/,'').split('/')[0];
const api=async(a,d)=>{try{const r=await(await fetch('/api',{method:'POST',body:JSON.stringify(Object.assign({i:T.initData},d||{},{a:a}))})).json();if(r.e){toast(r.e);return null}return r}catch(e){toast('Network error');return null}};
const act=async(a,d)=>{const b0=S?S.u.b:0,r=await api(a,d);if(!r)return;
if(ADM.indexOf(a)>-1){AD=r;if(a=='as'){await act('me');return}}
else{S=r;off=r.now-Date.now();if(a!='me')HI=null;if(a=='vo')BD=null}
render();if(S&&S.u.b>b0+1e-9&&['mc','tc','rc','sc'].indexOf(a)>-1){toast('+'+f(S.u.b-b0)+' SPC');try{T.HapticFeedback.notificationOccurred('success')}catch(e){}}};
const L={rate:'Mining SPC / day',minc:'Min claim',refrw:'Referral reward',secs:'Task wait seconds (min 30)',dtr:'Default daily task reward',prw:'Promoted task reward',wd:'Withdraw (1 on, 0 off)',minw:'Min withdraw',ch:'Required channels (@a,@b)',dep:'USDT BEP20 deposit address',wl:'Withdraw address label',vp1:'VIP USDT',vp2:'VVIP USDT',vc:'VIP coin price',vr:'VIP SPC/day',disc:'VIP promo discount %',mins:'Min send',srw:'Story reward',sm:'Story image URL (https)',rmn:'Rich man slots/day',rmh:'Rich man hours'};
function home(){const u=S.u,m=u.mst;return '<div class="c"><span class="m">'+(m?'<i class="pl"></i>Mining live · ':'Mining · ')+S.er+' SPC / day</span><div class="big" id="mn">0.000000</div><div class="pb"><i id="pg"></i></div><span class="m">Claim opens at '+S.c.minc+' SPC</span><br><br>'+(m?'<button class="b" id="cb" data-a="mc" disabled>Claim</button>':'<button class="b" data-a="ms">▶ Start mining</button>')+'</div><p class="m" style="text-align:center">Support @{{AU}}</p>'}
function story(){if(!S.c.sm)return '';const u=S.u,n=Date.now()+off,wt=u.sl&&n-u.sl<6048e5,rem=u.ss?Math.ceil(S.c.secs-(n-u.ss)/1e3):0;
return '<div class="c"><b>Telegram story</b><p class="m">Post a story and earn '+S.c.srw+' SPC, once every 7 days.</p>'+(wt?'<button class="b" disabled>Next in '+Math.ceil((6048e5-(n-u.sl))/864e5)+'d</button>':!u.ss?'<button class="b" data-a="sv">Post story</button>':rem>0?'<button class="b" disabled>⏳ '+rem+'s</button>':'<button class="b" data-a="sc">Claim '+S.c.srw+'</button>')+'</div>'}
function tl(){const R=k=>{const rem=k.s?Math.ceil(S.c.secs-(Date.now()+off-k.s)/1e3):0;
const b=k.dc?'<button class="b" disabled>Done ✓</button>':!k.s?'<button class="b" data-a="v" data-t="'+k.id+'" data-url="'+esc(k.url)+'">Visit</button>':rem>0?'<button class="b" disabled>⏳ '+rem+'s</button>':'<button class="b" data-a="tc" data-t="'+k.id+'">Claim</button>';
return '<div class="c"><span class="m">'+(k.o?'Promoted':'Daily')+'</span><div style="margin:4px 0;word-break:break-all">'+esc(host(k.url))+'</div><b style="color:var(--a)">+'+f(k.rw)+' 🕷</b><br>'+b+'</div>'};
return S.tk.length?'<div class="g">'+S.tk.map(R).join('')+'</div>':'<div class="c m">No tasks yet. Come back soon.</div>'}
function promo(){const P=[[1,5000,1,500,'visits'],[2,10000,2,1000,'visits'],[3,20000,4,1000,'unique visits']];
return '<div class="c" data-f><b>🚀 Promote a link</b><p class="m">TikTok, Telegram or any https site. Members earn '+S.c.prw+' 🕷 per visit.</p><input name="url" placeholder="https://..."><select name="p">'+P.map(p=>'<option value="'+p[0]+'">'+p[3]+' '+p[4]+' · '+p[1]+' coins / '+p[2]+' USDT</option>').join('')+'</select><select name="pay"><option value="c">Pay with coins'+(S.lv?' (-'+S.c.disc+'%)':'')+'</option>'+(S.lv>1?'<option value="f">Free monthly (1k visits)</option>':'')+'<option value="u">Pay with USDT (BEP20)</option></select><input name="tx" placeholder="USDT TX hash (USDT only)"><p class="m">USDT address: '+esc(S.c.dep||'coming soon')+'<br>USDT orders are reviewed manually by an admin.</p><button class="b" data-a="pr">Submit</button></div>'}
function tasks(){return story()+tl()+promo()}
function refer(){const u=S.u,l='https://t.me/'+S.bot+'?start=r'+u.id;
let x='<div class="c"><b>👥 Earn '+S.c.refrw+' 🕷 per referral</b><p class="m">Counts after your friend opens the app and joins all required channels.</p><input readonly value="'+l+'"><div class="g"><button class="b" data-a="cp" data-l="'+l+'">Copy</button><button class="b" data-a="sh" data-l="'+l+'">Share</button></div></div>';
x+='<div class="c"><div class="g"><div><span class="m">Referrals</span><div class="big">'+S.rf+'</div></div><div><span class="m">Claimable</span><div class="big">'+f(u.p)+'</div></div></div><button class="b" data-a="rc"'+(u.p>0?'':' disabled')+'>Claim '+f(u.p)+'</button></div>';
if(u.r&&!u.c)x+='<div class="c"><b>Join to activate your referrer</b>'+String(S.c.ch).split(',').filter(Boolean).map(h=>'<p><a data-a="ol" data-l="https://t.me/'+esc(h.trim().replace('@',''))+'" style="color:var(--a)">'+esc(h.trim())+'</a></p>').join('')+'<button class="b" data-a="ck">Verify</button></div>';
return x}
function wallet(){const u=S.u,v=S.lv,K={mc:'Mining',task:'Task',referral:'Referral',sent:'Sent',received:'Received',promo:'Promo',vip:'VIP',withdraw:'Withdraw',refund:'Refund',story:'Story',admin:'Admin'};
let x='<div class="c" style="text-align:center"><div class="cs">'+CN+CN+CN+'</div><span class="m">Balance (SPC)</span><div class="big">'+f(u.b)+'</div></div>';
x+='<div class="c" data-f><b>Send SPC</b><input name="to" placeholder="@username"><input name="amt" type="number" step="any" placeholder="Min '+S.c.mins+'"><button class="b" data-a="sd">Send</button></div>';
x+=S.c.wd=='1'?'<div class="c" data-f><b>Withdraw</b><p class="m">Requests are reviewed and paid manually by an admin.'+(v>1?' VVIP: priority review.':'')+'</p><input name="amt" type="number" step="any" placeholder="Min '+S.c.minw+'"><input name="ad" placeholder="'+esc(S.c.wl)+'"><button class="b" data-a="wd">Withdraw</button></div>':'<div class="c" style="text-align:center"><b>Withdrawal Start in 2027</b></div>';
x+='<div class="c" data-f><b>★ VIP badge</b><p class="m">VIP: mining '+S.c.vr+' SPC/day and '+S.c.disc+'% off coin promos. VVIP: also 1 free 1k promo every month and priority withdraw. Permanent badge.</p>'+(v?'<p>Active: '+(v>1?'VVIP':'VIP')+' (permanent)</p>':'')+'<button class="b" data-a="bv"'+(v>0?' disabled':'')+'>VIP · '+S.c.vc+' coins</button><select name="k"><option value="v1">VIP · '+S.c.vp1+' USDT</option><option value="v2">VVIP · '+S.c.vp2+' USDT</option></select><input name="tx" placeholder="USDT TX hash"><p class="m">USDT BEP20: '+esc(S.c.dep||'coming soon')+'<br>USDT orders are reviewed manually by an admin.</p><button class="b" data-a="vo">Buy with USDT</button></div>';
const hs=HI||[];return x+'<div class="c"><b>Wallet history</b>'+(hs.length?hs.map(h=>'<div class="r" style="border-bottom:1px solid var(--ln)"><span>'+(K[h.k]||esc(h.k))+(h.n?' · '+esc(h.n):'')+'<br><span class="m">'+new Date(h.ts).toLocaleString()+'</span></span><b style="color:'+(h.amt<0?'var(--rd)':'var(--a)')+'">'+(h.amt>0?'+':'')+f(h.amt)+'</b></div>').join(''):'<p class="m">No activity yet</p>')+'</div>'}
function board(){const B=BD||{lb:[],rm:[]};
return '<div class="c"><b>★ Rich men</b><p class="m">Donate 1 USDT to show your name here for '+S.c.rmh+'h. Max '+S.c.rmn+' per day. Reviewed manually by an admin.</p>'+B.rm.map(r=>'<div class="r"><b>'+esc(r.n)+'</b><span class="m">'+(r.un?'@'+esc(r.un):'')+'</span></div>').join('')+'<div data-f><input name="tx" placeholder="USDT TX hash"><p class="m">USDT BEP20: '+esc(S.c.dep||'coming soon')+'</p><button class="b" data-a="vo" data-k="rm">Donate 1 USDT</button></div></div><div class="c"><b>Top 100</b><p class="m">Ranked by VIP, referrals, then coins.</p>'+B.lb.map((r,i)=>'<div class="r" style="border-bottom:1px solid var(--ln)"><span><b>#'+(i+1)+'</b> '+esc(r.n)+(r.lv?' ★'+(r.lv>1?'VVIP':'VIP'):'')+'<br><span class="m">'+r.rc+' refs</span></span><b>'+f(r.b)+'</b></div>').join('')+'</div>'}
function ld(){if(tab=='w'&&!HI){HI=[];api('hi').then(r=>{if(r){HI=r.h;render()}else HI=null})}else if(tab=='b'&&!BD){BD={lb:[],rm:[]};api('lb').then(r=>{if(r){BD=r;render()}else BD=null})}}
function admin(){if(!AD||!AD.c){if(!AD){AD=1;act('al')}return '<p class="m">Loading…</p>'}
const bt=(a,id,ok,t,x)=>'<button class="b'+(x?' x':'')+'" data-a="'+a+'" data-id="'+id+'" data-ok="'+ok+'">'+t+'</button>';
let x='<div class="c"><b>🛠 Admin</b> <span class="m">Users: '+AD.n+'</span></div><div class="c" data-f><b>Settings</b>'+Object.keys(L).map(k=>'<span class="m">'+L[k]+'</span><input name="'+k+'" value="'+esc(AD.c[k])+'">').join('')+'<button class="b" data-a="as">Save</button></div>';
x+='<div class="c"><b>Daily tasks (max 10)</b>'+AD.tk.filter(k=>!k.o&&k.st=='a').map(k=>'<div data-f style="border-bottom:1px solid var(--ln);padding:6px 0"><input name="url" value="'+esc(k.url)+'"><input name="rw" type="number" step="any" value="'+k.rw+'"><div class="g"><button class="b" data-a="ae" data-id="'+k.id+'">Save</button>'+bt('ad',k.id,'','Delete',1)+'</div></div>').join('')+'<div data-f><input name="url" placeholder="https://..."><input name="rw" type="number" step="any" placeholder="Reward (default '+esc(AD.c.dtr)+')"><button class="b" data-a="at">Add task</button></div></div>';
x+='<div class="c"><b>Promo orders</b>'+AD.tk.filter(k=>k.o).map(k=>'<div class="r"><span>'+esc(k.url)+'<br><span class="m">owner '+k.o+' · left '+k.l+(k.st=='p'?' · '+esc(k.x):'')+'</span></span>'+(k.st=='p'?bt('ap',k.id,'1','✓')+bt('ap',k.id,'','✕',1):bt('ad',k.id,'','✕',1))+'</div>').join('')+'</div>';
x+='<div class="c"><b>VIP / Rich man orders</b>'+AD.od.map(o=>'<div class="r"><span>'+o.u+' · '+o.k+'<br><span class="m">'+esc(o.tx)+'</span></span>'+bt('ao',o.id,'1','✓')+bt('ao',o.id,'','✕',1)+'</div>').join('')+'</div>';
x+='<div class="c"><b>Withdraw requests</b>'+AD.w.map(w=>'<div class="r"><span>'+w.u+(w.lv>1?' VVIP':w.lv?' VIP':'')+' · '+f(w.amt)+'<br><span class="m">'+esc(w.ad)+'</span></span>'+bt('aw',w.id,'1','✓')+bt('aw',w.id,'','✕',1)+'</div>').join('')+'</div>';
const U=AD.usr;x+='<div class="c"><b>Users</b><div data-f><input name="s" placeholder="Telegram ID or @username"><button class="b" data-a="au">Find</button></div>'+(U?'<p>'+esc(U.n)+' · '+U.id+(U.un?' · @'+esc(U.un):'')+'<br>Balance '+f(U.b)+(U.bn?' · BLOCKED':'')+(U.isa?' · ADMIN':'')+'</p><div data-f><input name="amt" type="number" step="any" placeholder="+/- SPC"><div class="g"><button class="b" data-a="ag" data-id="'+U.id+'">Adjust</button><button class="b x" data-a="ab" data-id="'+U.id+'" data-on="'+(U.bn?'':'1')+'">'+(U.bn?'Unblock':'Block')+'</button></div></div>':'')+'</div>';
x+='<div class="c"><b>Admins</b><div class="r"><span>'+AD.main+' · Main Admin</span></div>'+AD.ad.filter(z=>String(z.id)!=String(AD.main)).map(z=>'<div class="r"><span>'+z.id+'</span><button class="b x" data-a="aa" data-id="'+z.id+'" data-on="">✕</button></div>').join('')+'<div data-f><input name="id" type="number" placeholder="Telegram numeric ID"><button class="b" data-a="aa" data-on="1">Add admin</button></div></div>';
return x}
function render(){const u=S.u;
$('app').innerHTML='<header><div class="av">'+esc(Array.from(u.n||'?')[0])+'</div><div class="tt"><b>'+esc(u.n)+(S.lv?' ★'+(S.lv>1?'VVIP':'VIP'):'')+'</b><span>ID '+u.id+(u.un?' · @'+esc(u.un):'')+'</span></div><div class="pill" id="bal">'+f(u.b)+'</div></header><div class="pg">'+({h:home,t:tasks,r:refer,b:board,w:wallet,a:admin})[tab]()+'</div>';
const IC={h:'<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',t:'<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',r:'<circle cx="10" cy="8" r="3.5"/><path d="M3.5 20v-1a4 4 0 014-4h5a4 4 0 014 4v1"/>',b:'<path d="M5 20V10M12 20V4M19 20v-7"/>',w:'<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M16 13h2"/>',a:'<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>'};
const tb=[['h','Mine'],['t','Tasks'],['r','Refer'],['b','Board'],['w','Wallet']];if(S.adm)tb.push(['a','Admin']);
$('nav').innerHTML=tb.map(t=>'<a data-a="tab" data-t="'+t[0]+'" class="'+(tab==t[0]?'on':'')+'"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+IC[t[0]]+'</svg>'+t[1]+'</a>').join('');
const bl=$('bal');if(bl){if(pb!==null&&pb!=u.b){const a0=+pb,t0=performance.now(),to=+u.b,st=t=>{const k=Math.min(1,(t-t0)/600);bl.textContent=f(a0+(to-a0)*k);if(k<1)requestAnimationFrame(st)};requestAnimationFrame(st)}pb=u.b}ld()}
document.onclick=e=>{const b=e.target.closest('[data-a]');if(!b)return;try{T.HapticFeedback.impactOccurred('light')}catch(e){}const d=Object.assign({},b.dataset),a=d.a,F=b.closest('[data-f]');
if(F)F.querySelectorAll('input,select').forEach(i=>{if(i.name)d[i.name]=i.value});
if(a=='tab'){tab=d.t;render();const p=$('app');p.classList.remove('fi');void p.offsetWidth;p.classList.add('fi')}
else if(a=='v'){const l=d.url;if(l.indexOf('t.me/')>-1)T.openTelegramLink(l);else T.openLink(l);act('ts',{t:d.t})}
else if(a=='sv'){try{T.shareToStory(S.c.sm,{text:'Mine Spider Coin with me!',widget_link:{url:'https://t.me/'+S.bot+'?start=r'+S.u.id,name:'Spider Coin'}})}catch(e){}act('ss')}
else if(a=='cp'){try{navigator.clipboard.writeText(d.l);toast('Copied')}catch(e){toast('Copy failed')}}
else if(a=='sh')T.openTelegramLink('https://t.me/share/url?url='+encodeURIComponent(d.l)+'&text='+encodeURIComponent('Mine Spider Coin with me!'));
else if(a=='ol')T.openTelegramLink(d.l);else act(a,d)};
setInterval(()=>{const m=$('mn');if(m&&S){const u=S.u,v=u.mst?Math.min(Date.now()+off-u.mst,864e5)*S.er/864e5:0;m.textContent=v.toFixed(6);const b=$('cb');if(b)b.disabled=v<+S.c.minc;const g=$('pg');if(g)g.style.width=Math.min(100,v/+S.c.minc*100)+'%'}},100);
setInterval(()=>{if(S&&tab=='t'&&(S.tk.some(k=>k.s&&!k.dc&&Date.now()+off-k.s<S.c.secs*1e3+1e3)||S.u.ss&&Date.now()+off-S.u.ss<S.c.secs*1e3+1e3))render()},1000);
act('me');
</script></body></html>`;

// =====================================================================
// DEPLOYMENT
// 1. D1:        wrangler d1 create spc-db   (bind it as "DB" in wrangler.toml:
//               [[d1_databases]] binding="DB" database_name="spc-db" database_id="<id>")
//               Tables are created/migrated automatically on first request.
// 2. Secrets:   wrangler secret put BOT_TOKEN        (token from @BotFather)
//               wrangler secret put WEBHOOK_SECRET   (any random string, A-Z a-z 0-9 _ -)
// 3. Admin:     Main admin is the constant MAIN_ADMIN at the top (8825348718).
//               Optional override: wrangler.toml [vars] ADMIN_ID = "123456789".
//               Extra admins are added in the Admin panel by numeric Telegram ID.
// 4. Deploy:    wrangler deploy      (note your https://NAME.SUBDOMAIN.workers.dev URL)
// 5. Webhook:   curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
//                 -d "url=https://NAME.SUBDOMAIN.workers.dev/webhook" \
//                 -d "secret_token=<WEBHOOK_SECRET>"
// 6. BotFather: /mybots > SPC_Wallet_bot > Bot Settings > Menu Button
//               URL: https://NAME.SUBDOMAIN.workers.dev/app
// NOTE: USDT payments (VIP, Promo, Rich man) and withdrawals are NOT verified on-chain.
//       They are stored as pending and require manual admin approval.
// =====================================================================
