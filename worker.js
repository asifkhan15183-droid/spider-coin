// =====================================================================
// SPIDER COIN (SPC) - Telegram Mini App
// Single-file Cloudflare Worker (frontend + backend) + D1 database
// Bindings: D1 "DB" | Secrets: BOT_TOKEN, WEBHOOK_SECRET | Optional var: ADMIN_ID
// Version 1.1: Error Logs, Admin button at the top, tab names (Home, Ranking)
// Version 1.2: SPC to USDT rate (admin), USDT shown beside SPC, rate saved in history, community supply cap
// Version 1.2.1: header balance pill removed, rate card replaced by one line, bigger USDT line on the card
// Version 1.3: server-enforced 30s task timer, custom task button labels, Official Channel check for send and withdraw
// Version 1.4: referral Pending/Successful, new startapp link, referral boost, 3-level commission (pool), Spider Web
// =====================================================================
const MAIN_ADMIN = "8825348718", ADMIN_USER = "Spider_Incom", BOT_USER = "SPC_Wallet_bot";
const FOREVER = 4102444800000, SV = "10", APP_VERSION = "1.4";
// Supply: 10 billion SPC in total. The community (all user balances) may hold at most 50%.
const TOTAL_SUPPLY = 1e10, CAP_PCT = 50, COMMUNITY_CAP = TOTAL_SUPPLY * CAP_PCT / 100;
const CAPMSG = "The reward limit for the community supply is reached. Please try again later.";
let SUP = { t: 0, v: 0 };
const DEF = { rate: 10, minc: 5, refrw: 200, secs: 30, prw: 9.23, wd: 0, minw: 1000, ch: "", dep: "", wl: "USDT BEP20 address", vp1: 2, vp2: 10, vc: 1e5, vc2: 5e5, vr: 20, disc: 5, mins: 1000, srw: 100, sm: "", dtr: 15, spc: 25000, spu: 2, stt: 2000000, wbr: 100, wbf: 0, str: "", urt: "0.0001", cp1: 10, cp2: 5, cp3: 2.5 };
const NK = ["rate", "minc", "refrw", "secs", "prw", "minw", "vp1", "vp2", "vc", "vc2", "vr", "disc", "mins", "srw", "dtr", "spc", "spu", "stt", "wbr", "wbf"];
const PL = { 1: { c: 5e3, v: 500, q: 0 }, 2: { c: 1e4, v: 1000, q: 0 }, 3: { c: 2e4, v: 1000, q: 1 } };
const ADM = new Set(["al", "as", "at", "ae", "ad", "ap", "aw", "ao", "aa", "au", "ab", "ag", "ar", "ac", "cf", "sp", "sq", "so", "sx"]);
const ROLE = { as: "cfg", at: "tk", ae: "tk", ad: "tk", ap: "tk", aw: "wd", ao: "od", au: "us", ab: "us", ag: "us", ar: "rt", ac: "cm", cf: "cm", sp: "st", sq: "st", so: "st", sx: "main", aa: "main" };
const J = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const tg = async (env, m, b) => { try { const r = await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/" + m, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }); const j = await r.json(); if (j && j.ok === false && j.error_code !== 403) await logErr(env.DB, "bot", m, b && b.chat_id, "Telegram " + m + " failed: " + (j.description || j.error_code), "chat_id " + (b && b.chat_id)); return j } catch (e) { await logErr(env.DB, "bot", m, b && b.chat_id, e); return { ok: false } } };

// ---------------------------------------------------------------- error log (Admin > Error Logs)
// Saves a problem with time, action, user and stack trace (line numbers). Same problem = one row with a counter.
async function logErr(db, src, act, uid, err, extra) {
  try {
    if (!db) return;
    await init(db);
    const msg = String((err && err.message) || err || "Unknown error").slice(0, 300);
    const stk = String(extra !== undefined ? extra : (err && err.stack) || "").slice(0, 900);
    const loc = (stk.match(/([A-Za-z0-9_.\/-]+):([0-9]+):([0-9]+)/) || [""])[0];
    const sig = (src + "|" + act + "|" + msg + "|" + loc).slice(0, 400), now = Date.now();
    await db.prepare("INSERT INTO el(sig,src,act,u,msg,stk,n,ts,ls) VALUES(?,?,?,?,?,?,1,?,?) ON CONFLICT(sig) DO UPDATE SET n=n+1,ls=excluded.ls,u=excluded.u").bind(sig, String(src), String(act || "").slice(0, 20), Number(uid) || 0, msg, stk, now, now).run();
    await db.prepare("DELETE FROM el WHERE id IN (SELECT id FROM el ORDER BY ls DESC LIMIT -1 OFFSET 200)").run();
  } catch (e) { }
}
let READY = false, CC = { t: 0, d: null }, LB = { t: 0, d: null }, MK = { t: 0, d: null };

// ---------------------------------------------------------------- referral: Pending -> Successful
// Successful only when the invited user joined the Official Channel (checked now) AND started mining or finished a task.
async function refCheck(db, env, c, id) {
  try {
    const rf = await db.prepare("SELECT referrer FROM refs WHERE referred=? AND st='p'").bind(id).first(); if (!rf) return;
    const me = await db.prepare("SELECT c FROM u WHERE id=?").bind(id).first(); if (!me || me.c != 1) return;
    const a = await db.prepare("SELECT COALESCE((SELECT st FROM mining WHERE u=?),0) ms,(SELECT COUNT(*) FROM h WHERE u=? AND k='mc') m,(SELECT COUNT(*) FROM d WHERE u=? AND c=1) t").bind(id, id, id).first();
    if (!(a && (a.ms > 0 || a.m > 0 || a.t > 0))) return;
    if (chs(c.ch).length && await chanCheck(env, id, c)) return;
    const rw = Number(c.refrw) || 0, g = "EXISTS(SELECT 1 FROM refs WHERE referred=? AND st='p')";
    await db.batch([
      db.prepare("UPDATE u SET p=ROUND(p+?,6),rc=rc+1 WHERE id=? AND " + g).bind(rw, rf.referrer, id),
      db.prepare("UPDATE refs SET st='s',rw=?,ts=? WHERE referred=? AND st='p'").bind(rw, Date.now(), id)]);
  } catch (e) { await logErr(db, "server", "refcheck", id, e) }
}

// ---------------------------------------------------------------- 3-level lifetime commission (paid in SPC from the admin pool)
async function payCommission(db, c, buyer, ref, kd, base, unit) {
  try {
    const pcts = [Number(c.cp1), Number(c.cp2), Number(c.cp3)], rate = Number(c.urt);
    let cur = buyer;
    for (let lvl = 1; lvl <= 3; lvl++) {
      const r = await db.prepare("SELECT referrer FROM refs WHERE referred=? AND st='s'").bind(cur).first();
      if (!r) break; cur = r.referrer;
      const bp = Math.round((pcts[lvl - 1] || 0) * 100); if (!(bp > 0)) continue;
      const bm = Math.round(base * 1e6);
      const amt = unit == "usdt" ? (rate > 0 ? Math.round(bm * bp / 10000 / rate) / 1e6 : 0) : Math.round(bm * bp / 10000) / 1e6;
      if (!(amt > 0)) continue;
      const now = Date.now(), row = [ref, lvl, cur, buyer, kd, bp, base, unit, amt, now];
      if (await capOk(db, amt)) {
        const g = "NOT EXISTS(SELECT 1 FROM cm WHERE ref=? AND lvl=?) AND (SELECT b FROM cp WHERE id=1)>=?";
        const own = "EXISTS(SELECT 1 FROM cm WHERE ref=? AND lvl=? AND st='p' AND ts=?)";
        await db.batch([
          db.prepare("INSERT INTO cm(ref,lvl,u,src,kd,bp,base,ut,amt,st,ts) SELECT ?,?,?,?,?,?,?,?,?,'p',? WHERE " + g).bind(...row, ref, lvl, amt),
          db.prepare("INSERT INTO h(u,k,amt,ts,n,rt) SELECT ?,'commission',?,?,?,? WHERE " + own).bind(cur, amt, now, "Level " + lvl, String(c.urt), ref, lvl, now),
          db.prepare("UPDATE u SET b=ROUND(b+?,6) WHERE id=? AND " + own).bind(amt, cur, ref, lvl, now),
          db.prepare("UPDATE cp SET b=ROUND(b-?,6) WHERE id=1 AND " + own).bind(amt, ref, lvl, now)]);
      }
      // not paid (pool empty or supply cap): keep a record so the admin can see it
      await db.prepare("INSERT OR IGNORE INTO cm(ref,lvl,u,src,kd,bp,base,ut,amt,st,ts) VALUES(?,?,?,?,?,?,?,?,?,'u',?)").bind(...row).run();
    }
  } catch (e) { await logErr(db, "server", "commission", buyer, e) }
}

// ---------------------------------------------------------------- community supply cap
async function heldSum(db, fresh) {
  const n = Date.now();
  if (!fresh && SUP.t && n - SUP.t < 6e4) return SUP.v;
  const r = await db.prepare("SELECT COALESCE(SUM(b),0) s FROM u").first();
  SUP = { t: n, v: Number(r && r.s) || 0 }; return SUP.v;
}
async function capOk(db, add) {
  add = Number(add) || 0; if (add <= 0) return true;
  let h = await heldSum(db);
  if (h + add > COMMUNITY_CAP * 0.98) h = await heldSum(db, true);
  if (h + add > COMMUNITY_CAP) return false;
  SUP.v = h + add; return true;
}

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
      db.prepare("CREATE TABLE IF NOT EXISTS admins(id INTEGER PRIMARY KEY,by INTEGER DEFAULT 0,ts INTEGER DEFAULT 0,rl TEXT DEFAULT 'cfg,tk,us,wd,od,st')"),
      db.prepare("CREATE TABLE IF NOT EXISTS mining(u INTEGER PRIMARY KEY,st INTEGER DEFAULT 0)"),
      db.prepare("CREATE TABLE IF NOT EXISTS refs(referred INTEGER PRIMARY KEY,referrer INTEGER,rw REAL DEFAULT 0,ts INTEGER DEFAULT 0)"),
      db.prepare("CREATE TABLE IF NOT EXISTS txs(tx TEXT PRIMARY KEY,k TEXT,u INTEGER,ts INTEGER DEFAULT 0)"),
      db.prepare("CREATE TABLE IF NOT EXISTS stk(u INTEGER PRIMARY KEY,n INTEGER DEFAULT 0,fr INTEGER DEFAULT 0)"),
      db.prepare("CREATE TABLE IF NOT EXISTS inv(no TEXT PRIMARY KEY,u INTEGER,q INTEGER,pu REAL,cu TEXT,tot REAL,pm TEXT,tx TEXT,st TEXT,ts INTEGER,nm TEXT,un TEXT,lv INTEGER DEFAULT 0)"),
      db.prepare("CREATE TABLE IF NOT EXISTS stl(id INTEGER PRIMARY KEY AUTOINCREMENT,u INTEGER,k TEXT,q INTEGER,n TEXT,ts INTEGER)"),
      db.prepare("CREATE TABLE IF NOT EXISTS pl(id INTEGER PRIMARY KEY AUTOINCREMENT,no TEXT UNIQUE,k TEXT,pps REAL,nt TEXT,hold INTEGER,tot REAL,ts INTEGER,aid INTEGER)"),
      db.prepare("CREATE TABLE IF NOT EXISTS wb(u INTEGER,y TEXT,PRIMARY KEY(u,y))"),
      db.prepare("CREATE TABLE IF NOT EXISTS cm(id INTEGER PRIMARY KEY AUTOINCREMENT,ref TEXT,lvl INTEGER,u INTEGER,src INTEGER,kd TEXT,bp INTEGER,base REAL,ut TEXT,amt REAL,st TEXT,ts INTEGER)"),
      db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS cmu ON cm(ref,lvl)"),
      db.prepare("CREATE INDEX IF NOT EXISTS cmr ON cm(u,id)"),
      db.prepare("CREATE TABLE IF NOT EXISTS cp(id INTEGER PRIMARY KEY,b REAL DEFAULT 0)"),
      db.prepare("INSERT OR IGNORE INTO cp(id,b) VALUES(1,0)"),
      db.prepare("CREATE TABLE IF NOT EXISTS el(id INTEGER PRIMARY KEY AUTOINCREMENT,sig TEXT UNIQUE,src TEXT,act TEXT,u INTEGER DEFAULT 0,msg TEXT,stk TEXT,n INTEGER DEFAULT 1,ts INTEGER,ls INTEGER)")]);
    const addCols = async (tbl, list) => {
      const cols = ((await db.prepare("PRAGMA table_info(" + tbl + ")").all()).results || []).map(r => r.name);
      for (const [n, t] of list) if (!cols.includes(n)) { try { await db.prepare("ALTER TABLE " + tbl + " ADD COLUMN " + n + " " + t).run() } catch (e) { } }
    };
    await addCols("u", [["un", "TEXT DEFAULT ''"], ["vl", "INTEGER DEFAULT 0"], ["vx", "INTEGER DEFAULT 0"], ["fm", "TEXT DEFAULT ''"], ["sl", "INTEGER DEFAULT 0"], ["ss", "INTEGER DEFAULT 0"], ["rc", "INTEGER DEFAULT 0"], ["bn", "INTEGER DEFAULT 0"], ["ts", "INTEGER DEFAULT 0"], ["rg", "INTEGER DEFAULT 0"]]);
    await addCols("w", [["ts", "INTEGER DEFAULT 0"]]);
    await addCols("h", [["rt", "TEXT DEFAULT ''"]]);
    await addCols("t", [["bl", "TEXT DEFAULT ''"]]);
    await addCols("refs", [["st", "TEXT DEFAULT 's'"]]);
    await db.prepare("INSERT OR IGNORE INTO refs(referred,referrer,rw,ts,st) SELECT id,r,0,0,'p' FROM u WHERE r>0 AND c=0").run();
    await addCols("admins", [["rl", "TEXT DEFAULT 'cfg,tk,us,wd,od,st'"]]);
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
      db.prepare("CREATE INDEX IF NOT EXISTS invu ON inv(u,ts)"),
      db.prepare("CREATE INDEX IF NOT EXISTS invs ON inv(st,pm,ts)"),
      db.prepare("CREATE INDEX IF NOT EXISTS stlu ON stl(u,id)"),
      db.prepare("CREATE INDEX IF NOT EXISTS els ON el(ls)"),
      db.prepare("INSERT OR IGNORE INTO s(k,v) VALUES('_sold','0')"),
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
// Returns "" when the user is in every Official Channel, otherwise the message to show.
async function chanCheck(env, id, c) {
  for (const x of chs(c.ch)) {
    const r = await tg(env, "getChatMember", { chat_id: x, user_id: id });
    if (!r || !r.ok) return "Cannot check the Official Channel right now. Please try again later.";
    const st = r.result.status;
    if (st == "left" || st == "kicked" || (st == "restricted" && !r.result.is_member)) return "Join the Official Channel first. It is required to send and withdraw SPC.";
  }
  return "";
}

// ---------------------------------------------------------------- router
export default {
  async fetch(rq, env) {
    try {
      const U = new URL(rq.url), db = env.DB;
      if (U.pathname == "/webhook" && rq.method == "POST") {
        if (!env.WEBHOOK_SECRET || rq.headers.get("x-telegram-bot-api-secret-token") !== env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
        let up; try { up = await rq.json() } catch (e) { return new Response("ok") }
        const m = up.message;
        try {
        if (m && m.text && m.from && m.chat && m.chat.type == "private" && /^\/start(@\w+)?(\s|$)/.test(m.text)) {
          await init(db);
          const prm = m.text.split(/\s+/)[1] || ""; let r = /^r[0-9]{1,15}$/.test(prm) ? +prm.slice(1) : 0;
          if (r && (r == m.from.id || !(await db.prepare("SELECT id FROM u WHERE id=?").bind(r).first()))) r = 0;
          await db.batch([
            db.prepare("INSERT OR IGNORE INTO u(id,n,r,ts) VALUES(?,?,?,?)").bind(m.from.id, String(m.from.first_name || "User").slice(0, 64), r, Date.now()),
            db.prepare("UPDATE u SET r=? WHERE id=? AND r=0 AND rg=0 AND ?>0").bind(r, m.from.id, r)]);
          await tg(env, "sendMessage", { chat_id: m.chat.id, text: "🕷 Welcome to Spider Coin! Mine, complete tasks and invite friends.", reply_markup: { inline_keyboard: [[{ text: "🕸 Open App", web_app: { url: U.origin + "/app" } }]] } });
        }
        } catch (e) { await logErr(db, "server", "webhook", 0, e) }
        return new Response("ok");
      }
      if (U.pathname == "/api" && rq.method == "POST") {
        const rc = rq.clone();
        try { return await run(rq, env) } catch (e) {
          let a = "", uid = 0;
          try { const q = await rc.json(); a = String(q.a || "").slice(0, 12); uid = Number(JSON.parse(new URLSearchParams(String(q.i || "")).get("user") || "{}").id) || 0 } catch (e2) { }
          await logErr(db, "server", a, uid, e);
          return J({ e: "Server error. Please try again." }, 500);
        }
      }
      if (U.pathname == "/invoice" && rq.method == "GET") return await invoice(U, env);
      return new Response(HTML.replace("{{AU}}", ADMIN_USER).replace("{{VER}}", APP_VERSION), { headers: { "content-type": "text/html;charset=UTF-8", "cache-control": "no-store" } });
    } catch (e) { await logErr(env.DB, "server", "route", 0, e); return J({ e: "Server error. Please try again." }, 500) }
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
    HS = (w, k, m, n, g, gb) => P("INSERT INTO h(u,k,amt,ts,n,rt) SELECT ?,?,?,?,?,? WHERE " + g, w, k, m, now, n || "", String(c.urt), ...gb);
  const c = await getC(db, a == "wd" || ADM.has(a)), N = k => +c[k];
  c.secs = Math.max(30, +c.secs || 30);
  const SEL = "SELECT u.*,COALESCE((SELECT st FROM mining WHERE u=u.id),0) mst,EXISTS(SELECT 1 FROM admins WHERE id=u.id) isa,(SELECT rl FROM admins WHERE id=u.id) arl FROM u WHERE u.id=?";
  const un = (us.username || "").toLowerCase(), nm = String(us.first_name || "User").slice(0, 64);
  const sp = IP.get("start_param") || "";
  const rr = async () => { const r = /^r[0-9]{1,15}$/.test(sp) ? +sp.slice(1) : 0; return r && r != id && await Q("SELECT id FROM u WHERE id=?", r) ? r : 0 };
  let u = await Q(SEL, id);
  if (!u) { await X("INSERT OR IGNORE INTO u(id,n,r,ts,rg) VALUES(?,?,?,?,1)", id, nm, await rr(), now); u = await Q(SEL, id); if (u && u.r) await X("INSERT OR IGNORE INTO refs(referred,referrer,rw,ts,st) VALUES(?,?,0,?,'p')", id, u.r, now) }
  else if (!u.rg && !u.r) { const r0 = await rr(); if (r0) { await X("UPDATE u SET r=? WHERE id=?", r0, id); u.r = r0; await X("INSERT OR IGNORE INTO refs(referred,referrer,rw,ts,st) VALUES(?,?,0,?,'p')", id, r0, now) } }
  if ((u.un || "") !== un || u.n !== nm || !u.rg) {
    const st = []; if (un) st.push(P("UPDATE u SET un='' WHERE un=? AND id!=?", un, id));
    st.push(P("UPDATE u SET un=?,n=?,rg=1 WHERE id=?", un, nm, id)); await db.batch(st); u.un = un; u.n = nm; u.rg = 1;
  }
  const adm = String(id) == MAIN || u.isa == 1;
  const isMain = String(id) == MAIN, roles = new Set(String(u.arl || "").split(",")), can = r => isMain || (r !== "main" && roles.has(r));
  if (u.bn && !adm) return E("Your account is blocked");
  if (a == "ce") {
    const l = Math.floor(+q.l) || 0, cl = Math.floor(+q.c) || 0, m = String(q.m || "").slice(0, 300), t = String(q.t || "").slice(0, 3);
    if (m && !/^Script error/i.test(m)) await logErr(db, "client", "ui:" + t, id, m, "@" + l + ":" + cl + "\n" + String(q.st || "").slice(0, 700));
    return J({ ok: 1 });
  }
  if (a == "rl") {
    return J({
      l: (await P("SELECT r.referred id,u.n,u.un,r.st,r.ts FROM refs r JOIN u ON u.id=r.referred WHERE r.referrer=? ORDER BY r.ts DESC LIMIT 100", id).all()).results,
      cs: (await P("SELECT lvl,COUNT(*) n,COALESCE(SUM(amt),0) a FROM cm WHERE u=? AND st='p' GROUP BY lvl", id).all()).results,
      ch: (await P("SELECT lvl,kd,amt,ts FROM cm WHERE u=? AND st='p' ORDER BY id DESC LIMIT 30", id).all()).results
    });
  }
  if (a == "cm") { const has = chs(c.ch).length > 0; return J({ m: has ? !(await chanCheck(env, id, c)) : null }) }
  if (a == "lg" || a == "lc" || a == "lt") {
    if (!adm || !can("lg")) return E("You do not have permission for this action");
    if (a == "lt") throw new Error("Test error created by the admin button");
    if (a == "lc") { await X("DELETE FROM el"); return J({ lg: [] }) }
    return J({ lg: (await P("SELECT id,src,act,u,msg,stk,n,ts,ls FROM el ORDER BY ls DESC LIMIT 60").all()).results });
  }
  const lv = u.vx > now ? u.vl : 0, er = (lv ? N("vr") : N("rate")) * (1 + Math.min(100, 5 * (+u.rc || 0)) / 100);

  if (a == "hi") return J({ h: (await P("SELECT k,amt,ts,n,rt FROM h WHERE u=? ORDER BY id DESC LIMIT 50", id).all()).results });
  if (a == "lb") {
    if (!LB.d || now - LB.t > 6e4) {
      const r = await P("SELECT id,n,un,b,rc,IIF(vx>?,vl,0) lv FROM u WHERE bn=0 ORDER BY lv DESC,rc DESC,b DESC LIMIT 100", now).all();
      LB = { t: now, d: { lb: r.results, rm: [] } };
    }
    return J(LB.d);
  }

  const invNo = () => "SPC-" + new Date(now).toISOString().slice(2, 10).replace(/-/g, "") + "-" + String(id).slice(-4) + "-" + crypto.randomUUID().slice(0, 6).toUpperCase();
  const findTo = async raw => {
    const to = String(raw || "").replace(/^@/, "").trim().toLowerCase(), byId = /^[0-9]{5,15}$/.test(to);
    if (!byId && !/^[a-z0-9_]{4,32}$/.test(to)) return { e: "Enter a valid @username or Telegram ID" };
    const v = byId ? await Q("SELECT id,un FROM u WHERE id=? AND rg=1", +to) : await Q("SELECT id,un FROM u WHERE un=?", to);
    return v ? { v } : { e: "User not found (they must open the app once)" };
  };
  if (a == "fm") {
    if (!MK.d || now - MK.t > 2e4) {
      const r = await db.batch([P("SELECT v FROM s WHERE k='_sold'"), P("SELECT COUNT(*) n FROM stk WHERE n>0"), P("SELECT k,pps,nt,hold,tot,ts FROM pl ORDER BY id DESC LIMIT 20"), P("SELECT COALESCE(SUM(tot),0) t FROM pl WHERE k='p'")]);
      MK = { t: now, d: { sold: r[0].results[0] ? +r[0].results[0].v : 0, holders: r[1].results[0].n, en: r[2].results, paid: r[3].results[0].t } };
    }
    return J({ mk: MK.d });
  }
  if (a == "fi") {
    const r = await db.batch([P("SELECT no,q,pu,cu,tot,pm,st,ts FROM inv WHERE u=? ORDER BY ts DESC LIMIT 30", id), P("SELECT k,q,n,ts FROM stl WHERE u=? ORDER BY id DESC LIMIT 30", id)]);
    return J({ iv: r[0].results, sl: r[1].results });
  }

  // ------------------------------------------------------------ admin
  if (ADM.has(a)) {
    if (!adm) return E("No access");
    if (ROLE[a] && !can(ROLE[a])) return E("You do not have permission for this action");
    const OK = String(q.ok) == "1", ON = String(q.on) == "1", tid = Math.floor(+q.id);
    const find = async s => { s = String(s || "").trim().replace(/^@/, "").toLowerCase(); if (!s) return null; const f = "SELECT id,n,un,b,bn,EXISTS(SELECT 1 FROM admins WHERE id=u.id) isa FROM u WHERE "; return /^[0-9]+$/.test(s) ? Q(f + "id=?", +s) : Q(f + "un=?", s) };
    let usr = null, ex = null;
    switch (a) {
      case "al": break;
      case "ac": {
        const o = {};
        for (const k of ["cp1", "cp2", "cp3"]) { const v = String(q[k] === undefined ? "" : q[k]).trim(); if (!/^[0-9]{1,2}([.][0-9]{1,2})?$/.test(v) || Number(v) > 50) return E("Each percent must be 0 to 50 with up to 2 decimals"); o[k] = String(Number(v)) }
        for (const k in o) await X("INSERT OR REPLACE INTO s(k,v) VALUES(?,?)", k, o[k]); CC.d = null; break;
      }
      case "cf": {
        const m = Math.round(+q.amt * 1e6) / 1e6; if (!isFinite(m) || m === 0 || Math.abs(m) > 1e10) return E("Enter an amount (use - to take out of the pool)");
        const r = await X("UPDATE cp SET b=ROUND(b+?,6) WHERE id=1 AND b+?>=0", m, m); if (r.meta.changes != 1) return E("The pool cannot go below 0"); break;
      }
      case "ar": {
        const v0 = String(q.urt === undefined ? "" : q.urt).trim();
        if (!/^[0-9]{1,6}([.][0-9]{1,10})?$/.test(v0) || !(Number(v0) > 0)) return E("Enter a rate above 0 with up to 10 decimals, for example 0.0001");
        await X("INSERT OR REPLACE INTO s(k,v) VALUES(?,?)", "urt", v0.replace(/^0+([0-9])/, "$1")); CC.d = null; break;
      }
      case "as": {
        const o = {};
        for (const k of NK) if (q[k] !== undefined && q[k] !== "") { const v = Number(q[k]); if (!Number.isFinite(v) || v < 0) return E("Invalid value: " + k); o[k] = v }
        if (o.secs !== undefined && o.secs < 30) return E("Task wait time must be at least 30 seconds");
        for (const k of ["minc", "minw", "mins", "spc", "spu"]) if (o[k] !== undefined && !(o[k] > 0)) return E(k + " must be above 0");
        if (o.disc > 100) return E("Discount max 100");
        if (o.stt !== undefined) { const sd = +((await Q("SELECT v FROM s WHERE k='_sold'")) || { v: 0 }).v; if (o.stt < sd) return E("Total stock cannot be below sold (" + sd + ")") }
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
        await X("INSERT INTO t(url,rw,bl) VALUES(?,?,?)", url, rw, String(q.bl || "").trim().slice(0, 24)); break;
      }
      case "ae": {
        const url = String(q.url || "").trim(), rw = +q.rw;
        if (!/^https:[/][/]\S{3,480}$/.test(url) || !(rw > 0)) return E("Valid https link and reward needed");
        await X("UPDATE t SET url=?,rw=?,bl=? WHERE id=? AND o=0 AND st='a'", url, rw, String(q.bl || "").trim().slice(0, 24), tid); break;
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
        else if (o.k == "rm") await X("UPDATE o SET st='x' WHERE id=? AND st='p'", o.id);
        else {
          const g = "EXISTS(SELECT 1 FROM o WHERE id=? AND st='p')";
          const rv = await db.batch([P("UPDATE u SET vl=MAX(CASE WHEN vx>? THEN vl ELSE 0 END,?),vx=? WHERE id=? AND " + g, now, o.k == "v2" ? 2 : 1, FOREVER, o.u, o.id), P("UPDATE o SET st='a' WHERE id=? AND st='p'", o.id)]);
          if (rv[1].meta.changes == 1) await payCommission(db, c, o.u, "o:" + o.id, "vip", N(o.k == "v2" ? "vp2" : "vp1"), "usdt");
        }
        break;
      }
      case "aa": {
        if (!(tid > 0)) return E("Enter a numeric Telegram ID");
        if (String(tid) == MAIN) return E("Main admin cannot be changed");
        if (ON) {
          const rl = [...new Set(String(q.rl || "").split(",").map(x => x.trim()).filter(x => ["cfg", "tk", "us", "wd", "od", "st", "lg", "rt", "cm"].includes(x)))];
          if (!rl.length) return E("Choose at least one role");
          await X("INSERT INTO admins(id,by,ts,rl) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET rl=excluded.rl", tid, id, now, rl.join(","));
        } else await X("DELETE FROM admins WHERE id=?", tid);
        break;
      }
      case "sp": {
        const pps = Math.round(Number(q.pps) * 1e6) / 1e6, kind = q.kd == "l" ? "l" : "p", nt = String(q.nt || "").trim().slice(0, 200);
        if (!(pps > 0 && pps <= 1e7)) return E("Enter a valid amount per stock");
        if (q.kd != "l") { const tot = Number((await Q("SELECT COALESCE(SUM(n),0) s FROM stk")).s) * pps; if (!(await capOk(db, tot))) return E(CAPMSG) }
        if (await Q("SELECT 1 x FROM pl WHERE ts>? AND pps=? AND k=?", now - 15000, pps, kind)) return E("Duplicate entry blocked. Wait a few seconds.");
        const no = "PL" + now + crypto.randomUUID().slice(0, 4), mk = "EXISTS(SELECT 1 FROM pl WHERE no=?)", hold = "(SELECT COALESCE(SUM(n),0) FROM stk)";
        const st = [P("INSERT INTO pl(no,k,pps,nt,hold,tot,ts,aid) SELECT ?,?,?,?," + hold + "," + (kind == "p" ? hold + "*?" : "0") + ",?,? WHERE 1", ...(kind == "p" ? [no, kind, pps, nt, pps, now, id] : [no, kind, pps, nt, now, id]))];
        if (kind == "p") st.push(P("INSERT INTO h(u,k,amt,ts,n,rt) SELECT u,'farm',ROUND(n*?,6),?,?,? FROM stk WHERE n>0 AND " + mk, pps, now, nt.slice(0, 40) || "Profit share", String(c.urt), no),
          P("UPDATE u SET b=ROUND(b+(SELECT n FROM stk WHERE u=u.id)*?,6) WHERE id IN (SELECT u FROM stk WHERE n>0) AND " + mk, pps, no));
        await db.batch(st); MK.d = null; break;
      }
      case "sq": await X("INSERT OR REPLACE INTO s(k,v) VALUES('str',?)", String(q.str || "").slice(0, 3000)); CC.d = null; break;
      case "so": {
        const no = String(q.no || ""), o = await Q("SELECT * FROM inv WHERE no=? AND st='p' AND pm='usdt'", no); if (!o) return E("Already processed");
        const g = "EXISTS(SELECT 1 FROM inv WHERE no=? AND st='p')";
        if (OK) {
          const r = await db.batch([P("INSERT OR IGNORE INTO stk(u,n) SELECT ?,0 WHERE " + g, o.u, no), P("UPDATE stk SET n=n+? WHERE u=? AND " + g, o.q, o.u, no),
            P("INSERT INTO stl(u,k,q,n,ts) SELECT ?,?,?,?,? WHERE " + g, o.u, "buy", o.q, "USDT", now, no), P("UPDATE inv SET st='a',ts=? WHERE no=? AND st='p'", now, no)]);
          if (r[3].meta.changes != 1) return E("Already processed");
          await payCommission(db, c, o.u, "inv:" + no, "stock", +o.tot, "usdt");
        } else {
          const r = await db.batch([P("UPDATE s SET v=CAST(MAX(0,CAST(v AS INTEGER)-?) AS TEXT) WHERE k='_sold' AND " + g, o.q, no), P("UPDATE inv SET st='x' WHERE no=? AND st='p'", no)]);
          if (r[1].meta.changes != 1) return E("Already processed");
        }
        await tg(env, "sendMessage", { chat_id: o.u, text: OK ? "✅ Your SPC Farm stock order (" + o.q + " stock) was approved. Download your invoice in the Farm tab." : "❌ Your SPC Farm stock order was rejected." });
        MK.d = null; break;
      }
      case "sx": {
        ex = (await P("SELECT stk.u id,u.n,u.un,IIF(u.vx>?,u.vl,0) lv,stk.n stocks,stk.fr fr,(SELECT COALESCE(SUM(tot),0) FROM inv WHERE inv.u=stk.u AND inv.pm='coin' AND inv.st='a') coins,(SELECT COALESCE(SUM(tot),0) FROM inv WHERE inv.u=stk.u AND inv.pm='usdt' AND inv.st='a') usdt FROM stk JOIN u ON u.id=stk.u WHERE stk.n>0 ORDER BY stk.n DESC LIMIT 5000", now).all()).results; break;
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
        if (m > 0 && !(await capOk(db, m))) return E(CAPMSG);
        const g = m > 0 ? "EXISTS(SELECT 1 FROM u WHERE id=?)" : "(SELECT b FROM u WHERE id=?)>=?", gb = m > 0 ? [t.id] : [t.id, -m];
        const r = await db.batch([HS(t.id, "admin", m, "Admin", g, gb), P("UPDATE u SET b=ROUND(b+?,6) WHERE id=? AND " + g, m, t.id, ...gb)]);
        if (r[1].meta.changes != 1) return E("User balance is too low"); usr = await find(String(t.id)); break;
      }
    }
    const r = await db.batch([
      can("tk") ? P("SELECT * FROM t WHERE st IN('a','p') ORDER BY st DESC,id DESC LIMIT 80") : P("SELECT 1 x WHERE 0"),
      can("wd") ? P("SELECT w.*,IIF(u.vx>?,u.vl,0) lv FROM w JOIN u ON u.id=w.u WHERE w.st='p' ORDER BY lv DESC,w.id LIMIT 100", now) : P("SELECT 1 x WHERE 0"),
      can("od") ? P("SELECT * FROM o WHERE st='p' ORDER BY id LIMIT 100") : P("SELECT 1 x WHERE 0"),
      isMain ? P("SELECT id,rl FROM admins ORDER BY id") : P("SELECT 1 x WHERE 0"),
      P("SELECT COUNT(*) n FROM u"),
      can("st") ? P("SELECT no,u,q,tot,tx,nm,ts FROM inv WHERE st='p' AND pm='usdt' ORDER BY ts LIMIT 100") : P("SELECT 1 x WHERE 0")]);
    return J({ c: await getC(db, true), tk: r[0].results, w: r[1].results, od: r[2].results, ad: r[3].results, n: r[4].results[0].n, so: r[5].results, main: MAIN, im: isMain, rl: isMain ? [] : [...roles], usr, ex, cmx: can("cm") ? { pool: +((await Q("SELECT b FROM cp WHERE id=1")) || { b: 0 }).b, ...(await Q("SELECT COALESCE(SUM(st='u'),0) un,COALESCE(SUM(st='p'),0) pn,COALESCE(SUM(CASE WHEN st='p' THEN amt END),0) pa,COALESCE(SUM(CASE WHEN st='u' THEN amt END),0) ua FROM cm")) } : null, sup: can("rt") ? { total: TOTAL_SUPPLY, cap: COMMUNITY_CAP, held: await heldSum(db, true) } : null });
  }

  // ------------------------------------------------------------ user actions
  switch (a) {
    case "me": break;
    case "ms": await db.batch([P("INSERT OR IGNORE INTO mining(u,st) VALUES(?,0)", id), P("UPDATE mining SET st=? WHERE u=? AND st=0", now, id)]); await refCheck(db, env, c, id); break;
    case "mc": {
      if (!u.mst) return E("Start mining first");
      const m = Math.floor(Math.min(now - u.mst, 864e5) * er / 864e5 * 1e6) / 1e6;
      if (!(m >= N("minc"))) return E("Minimum claim " + c.minc + " SPC");
      if (!(await capOk(db, m))) return E(CAPMSG);
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
      if (!(await capOk(db, +t.rw))) return E(CAPMSG);
      const g = "EXISTS(SELECT 1 FROM d WHERE u=? AND t=? AND y=? AND c=0)", gb = [id, t.id, yy];
      const st = [HS(id, "task", t.rw, "", g, gb), P("UPDATE u SET b=ROUND(b+?,6) WHERE id=? AND " + g, t.rw, id, ...gb)];
      if (t.o) st.push(P("UPDATE t SET l=l-1,st=IIF(l<=1,'x','a') WHERE id=? AND " + g, t.id, ...gb));
      st.push(P("UPDATE d SET c=1 WHERE u=? AND t=? AND y=? AND c=0", ...gb));
      const r = await db.batch(st); if (r[1].meta.changes != 1) return E("Already claimed");
      await refCheck(db, env, c, id);
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
      st.push(P("UPDATE u SET c=1 WHERE id=? AND c=0", id)); await db.batch(st);
      await refCheck(db, env, c, id);
      break;
    }
    case "rc": {
      const p = +u.p; if (!(p > 0)) return E("Nothing to claim");
      if (!(await capOk(db, p))) return E(CAPMSG);
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
      { const cm = await chanCheck(env, id, c); if (cm) return E(cm) }
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
      { const cm = await chanCheck(env, id, c); if (cm) return E(cm) }
      const byId = /^[0-9]{5,15}$/.test(to);
      if (!byId && !/^[a-z0-9_]{4,32}$/.test(to)) return E("Enter a valid @username or Telegram ID");
      const v = byId ? await Q("SELECT id,un FROM u WHERE id=? AND rg=1", +to) : await Q("SELECT id,un FROM u WHERE un=?", to);
      if (!v) return E("User not found (they must open the app once)");
      if (v.id == id) return E("You cannot send to yourself");
      const g = "(SELECT b FROM u WHERE id=?)>=?", gb = [id, m];
      const r = await db.batch([HS(id, "sent", -m, v.un ? "@" + v.un : "ID " + v.id, g, gb), HS(v.id, "received", m, un ? "@" + un : "ID " + id, g, gb),
        P("UPDATE u SET b=CASE WHEN id=? THEN ROUND(b-?,6) ELSE ROUND(b+?,6) END WHERE id IN (?,?) AND " + g, id, m, m, id, v.id, ...gb)]);
      if (r[2].meta.changes != 2) return E("Not enough coins"); break;
    }
    case "bv": {
      const t2 = q.k == "v2";
      if (!t2 && lv > 0) return E("You already have a VIP badge");
      if (t2 && lv > 1) return E("You already have VVIP");
      const k = N(t2 ? "vc2" : "vc"), g = "(SELECT b FROM u WHERE id=?)>=?", gb = [id, k];
      const r = await db.batch([HS(id, "vip", -k, t2 ? "VVIP" : "VIP", g, gb), P("UPDATE u SET b=ROUND(b-?,6),vl=?,vx=? WHERE id=? AND " + g, k, t2 ? 2 : 1, FOREVER, id, ...gb)]);
      if (r[1].meta.changes != 1) return E("Not enough coins");
      await payCommission(db, c, id, "bv:" + id + ":" + (t2 ? 2 : 1), "vip", k, "spc"); break;
    }
    case "vo": {
      const k = q.k, tx = String(q.tx || "").trim().toLowerCase();
      if (!["v1", "v2"].includes(k)) return E("Invalid order");
      if (!/^0x[0-9a-f]{64}$/.test(tx)) return E("Enter a valid USDT TX hash (0x + 64 hex)");
      if ((k == "v1" && lv > 0) || (k == "v2" && lv > 1)) return E("You already have this badge");
      const r = await db.batch([P("INSERT INTO o(u,k,tx,y) SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM txs WHERE tx=?)", id, k, tx, today, tx), P("INSERT OR IGNORE INTO txs(tx,k,u,ts) VALUES(?,?,?,?)", tx, k, id, now)]);
      if (r[0].meta.changes != 1) return E("This TX hash was already used"); break;
    }
    case "ss": {
      if (!c.sm) return E("Story task is not ready yet"); if (now - u.sl < 6048e5) return E("Available once every 7 days");
      await X("UPDATE u SET ss=? WHERE id=?", now, id); break;
    }
    case "sc": {
      if (!u.ss || now - u.ss < N("secs") * 1e3 || now - u.sl < 6048e5) return E("Post the story first");
      if (!(await capOk(db, N("srw")))) return E(CAPMSG);
      const g = "(SELECT ss FROM u WHERE id=?)=?", gb = [id, u.ss];
      const r = await db.batch([HS(id, "story", N("srw"), "", g, gb), P("UPDATE u SET b=ROUND(b+?,6),sl=?,ss=0 WHERE id=? AND " + g, N("srw"), now, id, ...gb)]);
      if (r[1].meta.changes != 1) return E("Already claimed"); break;
    }
    case "fb": case "fu": case "ff": {
      const free = a == "ff", usdt = a == "fu";
      const qn = free ? 1 : Math.floor(+q.q);
      if (!(qn >= 1 && qn <= 1000)) return E("Quantity must be between 1 and 1000");
      const tt = N("stt"), sold = +((await Q("SELECT v FROM s WHERE k='_sold'")) || { v: 0 }).v;
      if (sold + qn > tt) return E(tt - sold > 0 ? "Only " + (tt - sold) + " stock left" : "All stocks are sold out");
      const no = invNo(), mk = "EXISTS(SELECT 1 FROM inv WHERE no=?)", sg = "(SELECT CAST(v AS INTEGER) FROM s WHERE k='_sold')+?<=?";
      const ins = "INSERT INTO inv(no,u,q,pu,cu,tot,pm,tx,st,ts,nm,un,lv) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ";
      const bump = P("UPDATE s SET v=CAST(CAST(v AS INTEGER)+? AS TEXT) WHERE k='_sold' AND " + mk, qn, no);
      const hold = P("INSERT OR IGNORE INTO stk(u,n) SELECT ?,0 WHERE " + mk, id, no);
      if (free) {
        if (lv < 2) return E("Free stock is for VVIP members only");
        const g = "COALESCE((SELECT fr FROM stk WHERE u=?),0)=0 AND " + sg;
        const r = await db.batch([P(ins + g, no, id, 1, 0, "SPC", 0, "free", "", "a", now, nm, un, lv, id, 1, tt), bump, hold,
          P("UPDATE stk SET n=n+1,fr=1 WHERE u=? AND " + mk, id, no), P("INSERT INTO stl(u,k,q,n,ts) SELECT ?,?,?,?,? WHERE " + mk, id, "free", 1, "VVIP bonus", now, no)]);
        if (r[0].meta.changes != 1) return E("Free stock already claimed"); break;
      }
      if (usdt) {
        const tx = String(q.tx || "").trim().toLowerCase(); if (!/^0x[0-9a-f]{64}$/.test(tx)) return E("Enter a valid USDT TX hash (0x + 64 hex)");
        const pr = N("spu"), g = "NOT EXISTS(SELECT 1 FROM txs WHERE tx=?) AND " + sg;
        const r = await db.batch([P(ins + g, no, id, qn, pr, "USDT", Math.round(pr * qn * 1e6) / 1e6, "usdt", tx, "p", now, nm, un, lv, tx, qn, tt), bump, P("INSERT OR IGNORE INTO txs(tx,k,u,ts) SELECT ?,?,?,? WHERE " + mk, tx, "stock", id, now, no)]);
        if (r[0].meta.changes != 1) return E("This TX hash was already used"); break;
      }
      const pr = N("spc"), tot = Math.round(pr * qn * 1e6) / 1e6;
      if (u.b < tot) return E("Not enough coins (need " + tot + " SPC)");
      const g = "(SELECT b FROM u WHERE id=?)>=? AND " + sg;
      const r = await db.batch([P(ins + g, no, id, qn, pr, "SPC", tot, "coin", "", "a", now, nm, un, lv, id, tot, qn, tt), HS(id, "stock", -tot, qn + " stock", mk, [no]), bump, hold,
        P("UPDATE stk SET n=n+? WHERE u=? AND " + mk, qn, id, no), P("INSERT INTO stl(u,k,q,n,ts) SELECT ?,?,?,?,? WHERE " + mk, id, "buy", qn, "SPC", now, no), P("UPDATE u SET b=ROUND(b-?,6) WHERE id=? AND " + mk, tot, id, no)]);
      if (r[0].meta.changes != 1) return E("Not enough coins or stock sold out");
      await payCommission(db, c, id, "inv:" + no, "stock", tot, "spc"); break;
    }
    case "xs": {
      const qn = Math.floor(+q.q); if (!(qn >= 1 && qn <= 2000000)) return E("Enter a valid stock quantity");
      const f = await findTo(q.to); if (f.e) return E(f.e);
      const v = f.v; if (v.id == id) return E("You cannot send to yourself");
      const g = "COALESCE((SELECT n FROM stk WHERE u=?),0)>=?", gb = [id, qn];
      const r = await db.batch([P("INSERT OR IGNORE INTO stk(u,n) VALUES(?,0)", v.id),
        P("INSERT INTO stl(u,k,q,n,ts) SELECT ?,?,?,?,? WHERE " + g, id, "sent", qn, v.un ? "@" + v.un : "ID " + v.id, now, ...gb),
        P("INSERT INTO stl(u,k,q,n,ts) SELECT ?,?,?,?,? WHERE " + g, v.id, "recv", qn, un ? "@" + un : "ID " + id, now, ...gb),
        P("UPDATE stk SET n=CASE WHEN u=? THEN n-? ELSE n+? END WHERE u IN (?,?) AND " + g, id, qn, qn, id, v.id, ...gb)]);
      if (r[3].meta.changes != 2) return E("Not enough stocks"); break;
    }
    case "wb": {
      if (!(u.ts > 0 && now - u.ts < 6048e5)) return E("The welcome bonus period has ended");
      const need = N("wbf"), rw = N("wbr"); if (!(rw > 0)) return E("Welcome bonus is off");
      if (need > 0 && (await Q("SELECT COUNT(*) n FROM refs WHERE referrer=? AND st='s'", id)).n < need) return E("Invite " + need + " friends first");
      if (!(await capOk(db, rw))) return E(CAPMSG);
      const g = "(SELECT COUNT(*) FROM wb WHERE u=?)<7 AND NOT EXISTS(SELECT 1 FROM wb WHERE u=? AND y=?)", gb = [id, id, today];
      const r = await db.batch([HS(id, "bonus", rw, "Welcome bonus", g, gb), P("UPDATE u SET b=ROUND(b+?,6) WHERE id=? AND " + g, rw, id, ...gb), P("INSERT INTO wb(u,y) SELECT ?,? WHERE " + g, id, today, ...gb)]);
      if (r[1].meta.changes != 1) return E("Already claimed today (or all 7 claimed)"); break;
    }
    default: return E("Unknown action");
  }
  const r = await db.batch([P(SEL, id),
    P("SELECT t.id,t.url,t.rw,t.o,t.q,t.bl,d.s,d.c dc FROM t LEFT JOIN d ON d.u=? AND d.t=t.id AND d.y=IIF(t.q=1,'0',?) WHERE t.st='a' AND t.o!=? AND NOT (t.o>0 AND d.c=1) ORDER BY t.o,t.id LIMIT 40", id, today, id),
    P("SELECT COUNT(*) n,COALESCE(SUM(st='p'),0) p,COALESCE(SUM(st='s'),0) s,COALESCE(SUM(CASE WHEN st='s' THEN rw END),0) e FROM refs WHERE referrer=?", id),
    P("SELECT n,fr FROM stk WHERE u=?", id),
    P("SELECT COUNT(*) n,COALESCE(SUM(y=?),0) t FROM wb WHERE u=?", today, id)]);
  u = r[0].results[0]; const l2 = u.vx > Date.now() ? u.vl : 0;
  return J({ u: { id: u.id, n: u.n, un: u.un, b: u.b, p: u.p, c: u.c, r: u.r, sl: u.sl, ss: u.ss, mst: u.mst }, c, tk: r[1].results, rf: r[2].results[0].s, rfs: r[2].results[0], sk: r[3].results[0] || { n: 0, fr: 0 }, wb: { n: r[4].results[0].n, t: r[4].results[0].t, on: u.ts > 0 && Date.now() - u.ts < 6048e5, end: u.ts + 6048e5, rw: N("wbr"), need: N("wbf") }, bot: BOT_USER, now: Date.now(), adm, lv: l2, er: (l2 ? N("vr") : N("rate")) * (1 + Math.min(100, 5 * (+u.rc || 0)) / 100), bst: Math.min(100, 5 * (+u.rc || 0)) });
}

// ---------------------------------------------------------------- invoice PDF (no external libraries)
async function invoice(U, env) {
  const db = env.DB; if (!db || !env.BOT_TOKEN) return new Response("Server is not configured", { status: 500 });
  const IP = new URLSearchParams(U.searchParams.get("i") || ""), us = await ver(IP, env.BOT_TOKEN);
  if (!us) return new Response("Open the app from Telegram", { status: 401 });
  await init(db);
  const no = String(U.searchParams.get("n") || "").slice(0, 40);
  const iv = await db.prepare("SELECT * FROM inv WHERE no=? AND st='a'").bind(no).first();
  if (!iv) return new Response("Invoice not found", { status: 404 });
  if (iv.u != us.id && String(us.id) != String(env.ADMIN_ID || MAIN_ADMIN)) return new Response("Forbidden", { status: 403 });
  return new Response(buildInvoice(iv), { headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="' + no.replace(/[^A-Za-z0-9-]/g, "") + '.pdf"', "cache-control": "no-store" } });
}
function buildInvoice(iv) {
  const pe = s => String(s == null ? "" : s).replace(/[^\x20-\x7e]/g, "?").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const tw = (s, z, b) => s.length * z * (b ? 0.58 : 0.5), fmt = n => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const cs = [], DK = "0.02 0.09 0.06", MD = "0.07 0.30 0.20", GD = "0.86 0.69 0.26", LT = "0.9 1 0.95", GR = "0.33 0.40 0.36", WH = "1 1 1";
  const rect = (x, y, w, h, c) => cs.push(c + " rg " + x + " " + y + " " + w + " " + h + " re f");
  const box = (x, y, w, h, c, lw) => cs.push(c + " RG " + lw + " w " + x + " " + y + " " + w + " " + h + " re S");
  const ln = (x1, y1, x2, y2, c, lw) => cs.push(c + " RG " + lw + " w " + x1 + " " + y1 + " m " + x2 + " " + y2 + " l S");
  const tx = (x, y, z, f, c, s, al) => { s = pe(s); const w = tw(s, z, f == "F2"); if (al == "r") x -= w; else if (al == "c") x -= w / 2; cs.push("BT /" + f + " " + z + " Tf " + c + " rg " + x.toFixed(1) + " " + y + " Td (" + s + ") Tj ET") };
  const circ = (cx, cy, r, c, lw) => { const k = 0.5523 * r, p = n => n.toFixed(1); cs.push(c + " RG " + lw + " w " + p(cx + r) + " " + p(cy) + " m " + p(cx + r) + " " + p(cy + k) + " " + p(cx + k) + " " + p(cy + r) + " " + p(cx) + " " + p(cy + r) + " c " + p(cx - k) + " " + p(cy + r) + " " + p(cx - r) + " " + p(cy + k) + " " + p(cx - r) + " " + p(cy) + " c " + p(cx - r) + " " + p(cy - k) + " " + p(cx - k) + " " + p(cy - r) + " " + p(cx) + " " + p(cy - r) + " c " + p(cx + k) + " " + p(cy - r) + " " + p(cx + r) + " " + p(cy - k) + " " + p(cx + r) + " " + p(cy) + " c S") };
  const wrap = (s, n) => { const o = []; let l = ""; for (const w of s.split(" ")) { if ((l + " " + w).trim().length > n) { o.push(l); l = w } else l = (l + " " + w).trim() } if (l) o.push(l); return o };
  const free = iv.pm == "free", tier = ["Standard", "VIP", "VVIP"][iv.lv || 0] || "Standard";
  const date = new Date(iv.ts).toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const method = iv.pm == "coin" ? "SPC Coins (wallet)" : iv.pm == "usdt" ? "USDT (BEP20)" : "VVIP Free Bonus";
  // header band with spider web
  rect(0, 722, 595, 120, DK);
  cs.push("q 0 722 595 120 re W n");
  for (let i = 0; i < 14; i++) { const a = Math.PI * 2 * i / 14; ln(500, 800, (500 + Math.cos(a) * 170).toFixed(1), (800 + Math.sin(a) * 170).toFixed(1), MD, 0.7) }
  for (let r = 28; r <= 168; r += 28) { let p = ""; for (let i = 0; i <= 14; i++) { const a = Math.PI * 2 * i / 14; p += (500 + Math.cos(a) * r).toFixed(1) + " " + (800 + Math.sin(a) * r).toFixed(1) + (i ? " l " : " m ") } cs.push(MD + " RG 0.7 w " + p + "S") }
  cs.push("Q");
  rect(0, 719, 595, 3, GD);
  tx(40, 788, 28, "F2", GD, "SPIDER COIN");
  tx(40, 766, 11, "F1", LT, "SPC FARM STOCK  |  OFFICIAL INVOICE");
  tx(40, 742, 9, "F3", GD, "Vision 2037  -  Farming investment community");
  tx(555, 790, 24, "F2", WH, "INVOICE", "r");
  tx(555, 770, 10, "F1", LT, "No: " + iv.no, "r");
  tx(555, 755, 9, "F1", LT, "Date: " + date, "r");
  tx(555, 741, 9, "F2", GD, "Status: " + (free ? "COMPLIMENTARY" : "PAID"), "r");
  // billed to / payment
  tx(40, 690, 8, "F2", GR, "BILLED TO");
  tx(40, 672, 15, "F2", DK, iv.nm || "Member");
  tx(40, 655, 10, "F1", GR, "Telegram ID: " + iv.u);
  tx(40, 641, 10, "F1", GR, "Username: " + (iv.un ? "@" + iv.un : "-"));
  tx(40, 627, 10, "F1", GR, "Membership: " + tier);
  tx(555, 690, 8, "F2", GR, "PAYMENT", "r");
  tx(555, 672, 12, "F2", DK, method, "r");
  tx(555, 655, 10, "F1", GR, "Currency: " + iv.cu, "r");
  // table
  rect(40, 585, 515, 26, MD);
  tx(52, 594, 9, "F2", WH, "DESCRIPTION"); tx(360, 594, 9, "F2", WH, "QTY", "r"); tx(450, 594, 9, "F2", WH, "UNIT PRICE", "r"); tx(545, 594, 9, "F2", WH, "TOTAL", "r");
  tx(52, 560, 12, "F2", DK, "SPC Farm Stock"); tx(52, 545, 8.5, "F1", GR, "Farming investment - profit share paid in SPC coins");
  tx(360, 560, 12, "F1", DK, String(iv.q), "r"); tx(450, 560, 11, "F1", DK, free ? "FREE" : fmt(iv.pu) + " " + iv.cu, "r"); tx(545, 560, 11, "F2", DK, fmt(iv.tot) + " " + iv.cu, "r");
  ln(40, 532, 555, 532, "0.8 0.85 0.82", 0.8);
  rect(330, 470, 225, 48, DK); tx(342, 500, 8, "F2", GD, "TOTAL"); tx(545, 482, 17, "F2", WH, fmt(iv.tot) + " " + iv.cu, "r");
  if (iv.tx) { tx(40, 505, 8, "F2", GR, "TRANSACTION HASH"); tx(40, 492, 7.5, "F1", DK, iv.tx.slice(0, 34)); tx(40, 482, 7.5, "F1", DK, iv.tx.slice(34)) }
  // information
  tx(40, 440, 10, "F2", DK, "STOCK HOLDER INFORMATION");
  ["Profit share is credited to your wallet in SPC coins as announced by the admin.", "Stock can be sent to and received from other members like coins.", "Holders receive a profit share only. Stock does not represent ownership of the project.", "Rules and market updates are published inside the SPC Farm tab."].forEach((s, i) => tx(40, 422 - i * 14, 8.5, "F1", GR, "-  " + s));
  // vision
  rect(40, 330, 515, 56, "0.93 0.98 0.95"); box(40, 330, 515, 56, GD, 1);
  tx(297.5, 366, 13, "F2", DK, "VISION 2037", "c"); tx(297.5, 349, 9, "F1", GR, "Mission: one major action every year  |  progress update every 3 months", "c");
  // disclaimer
  tx(40, 306, 8, "F2", GR, "DISCLAIMER");
  wrap("Participation in SPC Farm Stock is entirely voluntary and made by your own free choice. Profit is not guaranteed and values may go up or down. Because of technical reasons or any project problem, no person or the project team accepts liability for any profit or loss.", 112).forEach((s, i) => tx(40, 292 - i * 11, 8, "F1", GR, s));
  tx(40, 235, 11, "F3", MD, "Thank you for being part of SPC Farm.");
  // seal
  circ(500, 240, 40, GD, 1.6); circ(500, 240, 34, GD, 0.6);
  tx(500, 246, 8, "F2", MD, "SPC FARM", "c"); tx(500, 234, 9, "F2", MD, "VERIFIED", "c"); tx(500, 222, 8, "F2", MD, "2037", "c");
  // footer
  rect(0, 0, 595, 46, DK);
  tx(297.5, 28, 9, "F1", WH, "Support: @" + ADMIN_USER + "   |   Bot: @" + BOT_USER, "c");
  tx(297.5, 13, 7.5, "F3", GD, "This is a computer generated invoice and does not require a signature.", "c");
  const content = cs.join("\n");
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> >> /Contents 4 0 R >>",
    "<< /Length " + content.length + " >>\nstream\n" + content + "\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>"];
  let out = "%PDF-1.4\n"; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += (i + 1) + " 0 obj\n" + o + "\nendobj\n" });
  const xr = out.length;
  out += "xref\n0 " + (objs.length + 1) + "\n0000000000 65535 f \n" + offs.map(o => String(o).padStart(10, "0") + " 00000 n \n").join("") + "trailer\n<< /Size " + (objs.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xr + "\n%%EOF";
  return new TextEncoder().encode(out);
}

// ---------------------------------------------------------------- frontend
const HTML = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover">
<script src="https://telegram.org/js/telegram-web-app.js"></script><title>Spider Coin</title>
<style>
:root{--a:#2dffa0;--bg:#030a06;--ln:#143826;--mu:#7aa88f;--rd:#ff5470;--gd:#f0d27a}
*{box-sizing:border-box;margin:0;-webkit-tap-highlight-color:transparent}
html{background:var(--bg)}
body{font:14px/1.4 system-ui,sans-serif;color:#e8fff2;padding:0 12px 96px;min-height:100vh;max-width:480px;margin:0 auto;background:repeating-conic-gradient(from 0deg at 50% 0,rgba(45,255,160,.035) 0 1deg,transparent 1deg 14deg),repeating-radial-gradient(circle at 50% 0,rgba(45,255,160,.035) 0 1px,transparent 1px 44px),radial-gradient(120% 55% at 50% -8%,#0c4a2c 0,transparent 62%),var(--bg);background-attachment:fixed}
.g{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(145px,1fr))}
.c{background:linear-gradient(160deg,#0a1a12,#060f0a);border:1px solid var(--ln);border-radius:16px;padding:14px;margin-bottom:10px;box-shadow:0 6px 24px rgba(0,0,0,.35)}
.b{width:100%;padding:12px;border:1px solid rgba(110,230,170,.28);border-radius:12px;background:linear-gradient(135deg,#0f7a50,#094a31);color:#eafff3;font-weight:800;font-size:15px;margin-top:4px;transition:transform .1s;box-shadow:0 4px 14px rgba(0,0,0,.45);text-shadow:0 1px 0 rgba(0,0,0,.35)}
.b:active{transform:scale(.97)}.b:disabled{background:#12281c;color:var(--mu);box-shadow:none}
.b.x{background:var(--rd);color:#fff;box-shadow:none}.b.gd{background:linear-gradient(135deg,#f6dc8d,#c79a3b);color:#2a1d02;box-shadow:0 4px 16px rgba(240,210,122,.22)}
input,select{width:100%;padding:12px;margin:5px 0;border-radius:12px;border:1px solid var(--ln);background:#040c07;color:#e8fff2;font-size:16px}
nav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:480px;display:grid;grid-auto-flow:column;grid-auto-columns:1fr;background:rgba(5,14,9,.92);backdrop-filter:blur(10px);border-top:1px solid var(--ln);padding:6px 2px calc(6px + env(safe-area-inset-bottom))}
nav a{display:flex;flex-direction:column;align-items:center;gap:3px;padding:7px 0;font-size:11px;color:var(--mu)}nav a.on{color:var(--a)}
.big{font-size:clamp(28px,9vw,42px);font-weight:800;color:var(--a);font-variant-numeric:tabular-nums;letter-spacing:1px;margin:6px 0;text-shadow:0 0 18px rgba(45,255,160,.4)}
.m{color:var(--mu);font-size:12px}h3{margin:14px 0 8px}
header{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:10px;height:58px;margin:0 -12px;padding:0 12px;background:rgba(3,10,6,.94);backdrop-filter:blur(8px);border-bottom:1px solid var(--ln)}
.av{flex:none;width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#2dffa0,#0a8a52);color:#02140a;display:grid;place-items:center;font-weight:800;border:2px solid var(--gd)}
.tt{flex:1;min-width:0;display:flex;flex-direction:column}.tt b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tt span{font-size:12px;color:var(--mu)}
.pill{padding:6px 12px;border:1px solid var(--gd);border-radius:18px;font-weight:700;flex:none;font-variant-numeric:tabular-nums;color:var(--gd)}.pg{padding-top:12px}.gr{flex:none;width:36px;height:36px;border-radius:50%;border:1px solid var(--gd);color:var(--gd);display:grid;place-items:center;background:rgba(240,210,122,.06);cursor:pointer}.gr:active{transform:scale(.94)}
.pl{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--a);animation:pl 1.2s infinite}@keyframes pl{50%{opacity:.25;transform:scale(1.6)}}
.fi{animation:fi .22s}@keyframes fi{from{opacity:0;transform:translateY(8px)}}
#ts{position:fixed;top:66px;left:50%;transform:translate(-50%,-16px);background:#0d2418;border:1px solid var(--a);padding:10px 16px;border-radius:20px;opacity:0;transition:.25s;pointer-events:none;z-index:9;font-weight:700;max-width:92%;text-align:center}#ts.on{opacity:1;transform:translate(-50%,0)}
.r{display:flex;justify-content:space-between;gap:8px;align-items:center;word-break:break-all;padding:6px 0}.r .b{width:auto;padding:8px 12px;font-size:13px;margin:0}
.bd{display:inline-flex;align-items:center;gap:4px;padding:2px 9px 2px 7px;border-radius:20px;font-size:11px;font-weight:800;letter-spacing:.8px;vertical-align:middle;margin-left:6px}
.bd.v1{background:linear-gradient(135deg,#f6dc8d,#c79a3b);color:#2a1d02;box-shadow:0 0 10px rgba(240,210,122,.45)}
.bd.v2{background:linear-gradient(135deg,#eafff6,#7df0bd 50%,#2dd89a);color:#02241a;box-shadow:0 0 12px rgba(125,240,189,.6)}
.bd.s{padding:1px 7px;font-size:10px}
.mine{text-align:center;padding:18px 14px;background:radial-gradient(90% 60% at 50% 0,rgba(45,255,160,.15),transparent 70%),linear-gradient(160deg,#0a1f15,#050e09)}
.st{display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:800;letter-spacing:1.5px;border:1px solid var(--ln);color:var(--mu)}
.st.on{color:var(--a);border-color:rgba(45,255,160,.5);box-shadow:0 0 14px rgba(45,255,160,.25)}
.ringw{position:relative;width:min(76vw,290px);aspect-ratio:1;margin:14px auto}
.ring{width:100%;height:100%;transform:rotate(-90deg)}
.rb{fill:none;stroke:#0f2a1d;stroke-width:10}
.rf{fill:none;stroke:url(#gr);stroke-width:10;stroke-linecap:round;stroke-dasharray:553;stroke-dashoffset:553;transition:stroke-dashoffset .3s;filter:drop-shadow(0 0 6px rgba(45,255,160,.7))}
.rin{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}.rin .big{font-size:clamp(22px,7vw,30px);margin:4px 0}
.coin3{perspective:400px;height:54px}.coin3 svg{animation:sp 5s linear infinite}@keyframes sp{to{transform:rotateY(360deg)}}
.stat3{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:6px 0 12px}.stat3>div{background:#06120b;border:1px solid var(--ln);border-radius:12px;padding:9px 4px}.stat3 span{display:block;color:var(--mu);font-size:10px;letter-spacing:1px;text-transform:uppercase}.stat3 b{font-size:15px}
.vcard{position:relative;overflow:hidden;border-radius:20px;padding:18px;aspect-ratio:1.586/1;min-height:200px;color:#eafff3;background:radial-gradient(120% 120% at 100% 0,#16c47a 0,transparent 55%),linear-gradient(135deg,#052e1c 0,#0a5a37 45%,#031a10 100%);border:1px solid rgba(240,210,122,.4);box-shadow:0 14px 40px rgba(0,0,0,.6),0 0 30px rgba(45,255,160,.12);display:flex;flex-direction:column;justify-content:space-between;margin-bottom:12px}
.vcard::before{content:"";position:absolute;inset:0;background:repeating-conic-gradient(from 0deg at 100% 0,rgba(255,255,255,.05) 0 1deg,transparent 1deg 12deg),repeating-radial-gradient(circle at 100% 0,rgba(255,255,255,.05) 0 1px,transparent 1px 30px)}
.vcard.v1{border-color:rgba(240,210,122,.85)}.vcard.v2{background:radial-gradient(120% 120% at 100% 0,#a8f7d6 0,transparent 50%),linear-gradient(135deg,#0b3b28 0,#16825a 40%,#06241a 100%);border-color:#d8f5e8}
.sh{position:absolute;inset:0;background:linear-gradient(115deg,transparent 40%,rgba(255,255,255,.15) 50%,transparent 60%);transform:translateX(-100%);animation:sh 5s infinite}@keyframes sh{60%,100%{transform:translateX(100%)}}
.vr{display:flex;justify-content:space-between;align-items:center;position:relative}
.vbrand{font-weight:800;letter-spacing:3px;font-size:13px;color:var(--gd)}
.vl{font-size:9px;letter-spacing:1.5px;color:#9fd6b8}.vn{font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vamt{font-size:clamp(24px,8vw,32px);font-weight:800;text-shadow:0 2px 10px rgba(0,0,0,.45);font-variant-numeric:tabular-nums;position:relative}
.vno{font-family:ui-monospace,Menlo,monospace;letter-spacing:2.5px;font-size:15px;color:#d9fbe9;text-shadow:0 1px 0 rgba(0,0,0,.5);position:relative}
.vcard>div{position:relative}
.sg{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:4px;background:#06120b;border:1px solid var(--ln);border-radius:14px;padding:4px;margin-bottom:10px}
.sg a{padding:10px 0;text-align:center;border-radius:10px;color:var(--mu);font-weight:700;font-size:13px}.sg a.on{background:linear-gradient(135deg,#0f7a50,#094a31);color:#eafff3;box-shadow:inset 0 0 0 1px rgba(110,230,170,.35)}
.tier{border-radius:16px;padding:16px;margin-bottom:10px}
.tier.t1{background:linear-gradient(145deg,#1d1606,#0a0803);border:1px solid #c79a3b;box-shadow:0 0 22px rgba(240,210,122,.1)}
.tier.t2{background:linear-gradient(145deg,#06241a,#030f0a);border:1px solid #7df0bd;box-shadow:0 0 24px rgba(125,240,189,.15)}
.tier ul{list-style:none;padding:0;margin:10px 0}.tier li{padding:3px 0;color:#d9fbe9}
.b.gd{border-color:rgba(255,230,150,.5)}.b.x{border-color:transparent}
.dep{display:flex;gap:8px;align-items:center;background:#040c07;border:1px dashed #2e6b4c;border-radius:12px;padding:8px 8px 8px 12px;margin:6px 0}
.dep code{flex:1;min-width:0;word-break:break-all;font:12px/1.35 ui-monospace,Menlo,monospace;color:#d9fbe9}
.dep .b{width:auto;margin:0;padding:8px 14px;font-size:13px}
.fh{position:relative;overflow:hidden;border-radius:20px;padding:18px;margin-bottom:12px;color:#eafff3;background:radial-gradient(120% 100% at 100% 0,rgba(240,210,122,.22),transparent 55%),linear-gradient(145deg,#0b3a29,#04160e 70%);border:1px solid rgba(240,210,122,.6);box-shadow:0 14px 34px rgba(0,0,0,.5)}
.fh:before{content:"";position:absolute;inset:0;background:repeating-conic-gradient(from 0deg at 100% 0,rgba(240,210,122,.07) 0 1.5deg,transparent 1.5deg 13deg),repeating-radial-gradient(circle at 100% 0,rgba(240,210,122,.06) 0 1px,transparent 1px 34px);pointer-events:none}
.fh>*{position:relative}
.fhb{font-weight:900;letter-spacing:3px;font-size:19px;color:var(--gd)}
.fht{font-size:12px;color:#9fd6b8;margin-bottom:12px}
.fpr{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}.fpr>div{background:rgba(0,0,0,.3);border:1px solid rgba(240,210,122,.3);border-radius:12px;padding:8px 10px}.fpr span{display:block;font-size:9px;letter-spacing:1.5px;color:#9fd6b8}.fpr b{font-size:17px;color:#fff}
.fbar{height:8px;border-radius:4px;background:rgba(0,0,0,.45);overflow:hidden;border:1px solid rgba(240,210,122,.25)}.fbar i{display:block;height:100%;background:linear-gradient(90deg,#128a58,#f0d27a)}
.fst{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:10px 0;text-align:center}.fst b{display:block;font-size:15px}.fst span{font-size:10px;color:#9fd6b8;letter-spacing:1px;text-transform:uppercase}
.fv{font-size:9px;letter-spacing:1.6px;color:var(--gd);text-align:center;border-top:1px solid rgba(240,210,122,.25);padding-top:10px;line-height:1.6}
.cert{border-radius:16px;padding:16px;margin-bottom:12px;text-align:center;background:linear-gradient(145deg,#1b1507,#080602);border:1px solid #c79a3b;box-shadow:inset 0 0 0 4px #080602,inset 0 0 0 5px rgba(240,210,122,.4)}
.cert .big{color:var(--gd);text-shadow:0 0 16px rgba(240,210,122,.3)}
.mkst{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:8px 0}.mkst>div{background:#06120b;border:1px solid var(--ln);border-radius:12px;padding:8px 4px;text-align:center}.mkst b{display:block;font-size:15px}.mkst span{font-size:10px;color:var(--mu)}
.pfu{color:#3ddc97}.pfd{color:var(--rd)}
.wb .wbd{display:grid;grid-template-columns:repeat(7,1fr);gap:5px;margin:10px 0}.wb .wbd i{font-style:normal;text-align:center;padding:7px 0;border-radius:9px;background:#06120b;border:1px solid var(--ln);color:var(--mu);font-weight:800;font-size:12px}.wb .wbd i.on{background:linear-gradient(135deg,#f6dc8d,#c79a3b);color:#2a1d02;border-color:#c79a3b}
.rules{white-space:pre-wrap;color:#d9fbe9;line-height:1.55;word-break:break-word}
.disc{font-size:10.5px;line-height:1.5;color:var(--mu);border:1px solid var(--ln);border-radius:12px;padding:10px 12px;margin:4px 0 12px}
.ck{display:inline-flex;align-items:center;gap:6px;margin:4px 12px 4px 0;font-size:13px}.ck input{width:auto;margin:0}
textarea{width:100%;padding:12px;margin:5px 0;border-radius:12px;border:1px solid var(--ln);background:#040c07;color:#e8fff2;font-size:15px;font-family:inherit}
.chp{display:inline-block;padding:2px 9px;border-radius:12px;font-size:10px;font-weight:800;letter-spacing:.5px}.chp.a{background:rgba(61,220,151,.15);color:#3ddc97}.chp.p{background:rgba(240,210,122,.15);color:var(--gd)}.chp.x{background:rgba(255,84,112,.15);color:var(--rd)}
@media(prefers-reduced-motion:reduce){*{animation:none!important}}
</style></head><body><div id="app"><p class="m" style="padding:40px;text-align:center">Loading…</p></div><div id="ts"></div><nav id="nav"></nav>
<script>
const VER='{{VER}}',GEAR='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',CLOSE='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const T=Telegram.WebApp,$=s=>document.getElementById(s);T.ready();T.expand();try{T.setHeaderColor('#070d0a');T.setBackgroundColor('#070d0a')}catch(e){}
const ADM=['al','ar','ac','cf','as','at','ae','ad','ap','aw','ao','aa','au','ab','ag','sp','sq','so','sx'];
let S,off=0,tab='h',AD=0,pb=null,HI=null,BD=null,fsub='m',FM=null,FI=null;
const CN='<svg viewBox="0 0 64 64" width="52" height="52"><defs><radialGradient id="cg" cx=".35" cy=".3"><stop offset="0" stop-color="#7dffc4"/><stop offset="1" stop-color="#0a8a52"/></radialGradient></defs><circle cx="32" cy="32" r="29" fill="url(#cg)" stroke="#f0d27a" stroke-width="3"/><circle cx="32" cy="32" r="23" fill="none" stroke="#03140a" stroke-opacity=".45" stroke-width="2"/><path d="M32 16v32M20 22l24 20M44 22L20 42" stroke="#03140a" stroke-width="2.5" stroke-linecap="round"/></svg>';
let wsub='s';const OKM={sd:'Sent ✓',bv:'Badge activated ★',wd:'Withdrawal requested',pr:'Promo submitted',vo:'Order submitted for review',ms:'Mining started',fb:'Stock purchased ✓',fu:'USDT order submitted for review',ff:'Free stock claimed ✓',xs:'Stock sent ✓',wb:'Bonus claimed ✓',sp:'Entry posted ✓',sq:'Rules saved ✓',so:'Order processed ✓'};
const bdg=(l,sm)=>l?'<span class="bd v'+l+(sm?' s':'')+'">'+(l>1?'<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M12 2l9 8-9 12L3 10z"/></svg>VVIP':'<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M3 18h18l1-11-5 4-5-7-5 7-5-4z"/></svg>VIP')+'</span>':'';
const fm=n=>{n=+n;return n!==0&&Math.abs(n)<0.01?String(+n.toFixed(6)):n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})},fk=n=>(+n).toLocaleString('en-US'),cno=i=>String(i).padStart(16,'0').replace(/(.{4})/g,'$1 ').trim();
const toast=m=>{const e=$('ts');e.textContent=m;e.className='on';clearTimeout(toast.t);toast.t=setTimeout(()=>{e.className=''},2600)};
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';'),f=n=>{n=+n;return n!==0&&Math.abs(n)<0.01?String(+n.toFixed(6)):n.toFixed(2)},host=u=>String(u).replace(/^https?:[/][/]/,'').split('/')[0];
const api=async(a,d)=>{try{const r=await(await fetch('/api',{method:'POST',body:JSON.stringify(Object.assign({i:T.initData},d||{},{a:a}))})).json();if(r.e){toast(r.e);return null}return r}catch(e){toast('Network error');return null}};
const act=async(a,d)=>{const b0=S?S.u.b:0,r=await api(a,d);if(!r)return;
if(ADM.indexOf(a)>-1){AD=r;if(r.ex){exportSheet(r.ex);r.ex=null}if(a=='sp'||a=='so')FM=null;if(a=='as'||a=='sq'||a=='ar'||a=='ac'){await act('me');return}}
else{S=r;off=r.now-Date.now();if(a!='me')HI=null;if(a=='vo')BD=null;if(['fb','fu','ff','xs'].indexOf(a)>-1){FM=null;FI=null}}
render();if(S&&S.u.b>b0+1e-9&&['mc','tc','rc','sc','wb'].indexOf(a)>-1){toast('+'+f(S.u.b-b0)+' SPC');try{T.HapticFeedback.notificationOccurred('success')}catch(e){}}else if(OKM[a])toast(OKM[a])};
const L={rate:'Mining SPC / day',minc:'Min claim',refrw:'Referral reward',secs:'Task wait seconds (min 30)',dtr:'Default daily task reward',prw:'Promoted task reward',wd:'Withdraw (1 on, 0 off)',minw:'Min withdraw',ch:'Required channels (@a,@b)',dep:'USDT BEP20 deposit address',wl:'Withdraw address label',vp1:'VIP USDT',vp2:'VVIP USDT',vc:'VIP coin price',vc2:'VVIP coin price',vr:'VIP SPC/day',disc:'VIP promo discount %',mins:'Min send',srw:'Story reward',sm:'Story image URL (https)',spc:'Stock price (SPC coins)',spu:'Stock price (USDT)',stt:'Total stock limit',wbr:'Welcome bonus SPC per day',wbf:'Welcome bonus: referrals needed (0 = none)'};
function home(){const u=S.u,m=u.mst;
return homebal()+'<div class="c mine"><span class="st'+(m?' on':'')+'">'+(m?'<i class="pl"></i>MINING LIVE':'● IDLE')+'</span>'+(S.lv?'<div class="m" style="margin-top:8px">'+bdg(S.lv)+' boost active</div>':'')+'<div class="ringw"><svg class="ring" viewBox="0 0 200 200"><defs><linearGradient id="gr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2dffa0"/><stop offset="1" stop-color="#f0d27a"/></linearGradient></defs><circle class="rb" cx="100" cy="100" r="88"/><circle class="rf" id="rg" cx="100" cy="100" r="88"/></svg><div class="rin"><div class="coin3">'+CN+'</div><div class="big" id="mn">0.000000</div><span class="m" id="pc">SPC mined</span></div></div><div class="stat3"><div><span>Per day</span><b>'+S.er+'</b></div><div><span>Per hour</span><b>'+(S.er/24).toFixed(2)+'</b></div><div><span>Min claim</span><b>'+S.c.minc+'</b></div></div>'+(m?'<button class="b" id="cb" data-a="mc" disabled>Claim SPC</button>':'<button class="b" data-a="ms">▶ Start mining</button>')+'</div>'+wbc()+'<p class="m" style="text-align:center">Support @{{AU}}</p>'}
function story(){if(!S.c.sm)return '';const u=S.u,n=Date.now()+off,wt=u.sl&&n-u.sl<6048e5,rem=u.ss?Math.ceil(S.c.secs-(n-u.ss)/1e3):0;
return '<div class="c"><b>Telegram story</b><p class="m">Post a story and earn '+S.c.srw+' SPC, once every 7 days.</p>'+(wt?'<button class="b" disabled>Next in '+Math.ceil((6048e5-(n-u.sl))/864e5)+'d</button>':!u.ss?'<button class="b" data-a="sv">Post story</button>':rem>0?'<button class="b" disabled>⏳ '+rem+'s</button>':'<button class="b" data-a="sc">Claim '+S.c.srw+'</button>')+'</div>'}
function tl(){const R=k=>{const rem=k.s?Math.ceil(S.c.secs-(Date.now()+off-k.s)/1e3):0;
const b=k.dc?'<button class="b" disabled>Done ✓</button>':!k.s?'<button class="b" data-a="v" data-t="'+k.id+'" data-url="'+esc(k.url)+'">'+esc(k.bl||'Visit Link')+'</button>':rem>0?'<button class="b" disabled>⏳ '+rem+'s</button>':'<button class="b" data-a="tc" data-t="'+k.id+'">Claim</button>';
return '<div class="c"><span class="m">'+(k.o?'Promoted':'Daily')+'</span>'+(k.bl?'':'<div style="margin:4px 0;word-break:break-all">'+esc(host(k.url))+'</div>')+'<b style="color:var(--a)">+'+f(k.rw)+' 🕷</b><br>'+b+'</div>'};
return S.tk.length?'<div class="g">'+S.tk.map(R).join('')+'</div>':'<div class="c m">No tasks yet. Come back soon.</div>'}
function promo(){const P=[[1,5000,1,500,'visits'],[2,10000,2,1000,'visits'],[3,20000,4,1000,'unique visits']];
return '<div class="c" data-f><b>🚀 Promote a link</b><p class="m">TikTok, Telegram or any https site. Members earn '+S.c.prw+' 🕷 per visit.</p><input name="url" placeholder="https://..."><select name="p">'+P.map(p=>'<option value="'+p[0]+'">'+p[3]+' '+p[4]+' · '+p[1]+' coins / '+p[2]+' USDT</option>').join('')+'</select><select name="pay"><option value="c">Pay with coins'+(S.lv?' (-'+S.c.disc+'%)':'')+'</option>'+(S.lv>1?'<option value="f">Free monthly (1k visits)</option>':'')+'<option value="u">Pay with USDT (BEP20)</option></select><input name="tx" placeholder="USDT TX hash (USDT only)"><p class="m">USDT address:</p>'+dep(S.c.dep)+'<p class="m">USDT orders are reviewed manually by an admin.</p><button class="b" data-a="pr">Submit</button></div>'}
function tasks(){return story()+tl()+promo()}
let RFD=null,RFT=0;
function web(){const L=(RFD&&RFD.l)||[],n=Math.min(L.length,24);
let g='<svg viewBox="0 0 300 300" style="width:100%;max-width:340px;display:block;margin:6px auto">';
[40,80,120].forEach(function(r){g+='<circle cx="150" cy="150" r="'+r+'" fill="none" stroke="var(--ln)" stroke-width="1"/>'});
for(let i=0;i<n;i++){const an=Math.PI*2*i/Math.max(n,1)-Math.PI/2,x=150+110*Math.cos(an),y=150+110*Math.sin(an),ok=L[i].st=='s';
g+='<line x1="150" y1="150" x2="'+x.toFixed(1)+'" y2="'+y.toFixed(1)+'" stroke="'+(ok?'var(--a)':'var(--ln)')+'" stroke-width="'+(ok?1.4:1)+'" opacity="'+(ok?.8:.6)+'"/>'}
for(let i=0;i<n;i++){const an=Math.PI*2*i/Math.max(n,1)-Math.PI/2,x=150+110*Math.cos(an),y=150+110*Math.sin(an),ok=L[i].st=='s';
g+='<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="'+(ok?8:6)+'" fill="'+(ok?'var(--a)':'none')+'" stroke="'+(ok?'var(--a)':'var(--mu)')+'" stroke-width="1.5" opacity="'+(ok?1:.55)+'"/>'}
g+='<circle cx="150" cy="150" r="16" fill="var(--bg)" stroke="var(--gd)" stroke-width="2"/><text x="150" y="155" text-anchor="middle" font-size="14" fill="var(--gd)">You</text></svg>';
return '<div class="c"><b>My Spider Web</b><p class="m">Bright = Successful. Dim = Pending.'+(L.length>24?' Showing 24 of '+L.length+'.':'')+'</p>'+g+'</div>'}
function refer(){const u=S.u,l='https://t.me/'+S.bot+'?startapp=r'+u.id,s=S.rfs||{n:0,p:0,s:0,e:0},c=S.c;
if(Date.now()-RFT>3e4){RFT=Date.now();api('rl').then(function(r){if(r){RFD=r;render()}})}
let x='<div class="c"><b>👥 Earn '+c.refrw+' 🕷 per successful referral</b><input readonly value="'+l+'"><div class="g"><button class="b" data-a="cp" data-l="'+l+'">Copy link</button><button class="b" data-a="sh" data-l="'+l+'">Share</button></div></div>';
x+='<div class="c"><div class="stat3"><div><span>Total</span><b>'+s.n+'</b></div><div><span>Pending</span><b>'+s.p+'</b></div><div><span>Successful</span><b>'+s.s+'</b></div></div><div class="r"><span class="m">Referral earnings</span><b>'+f(s.e)+' SPC</b></div><div class="r"><span class="m">Ready to claim</span><b>'+f(u.p)+' SPC</b></div><button class="b" data-a="rc"'+(u.p>0?'':' disabled')+'>Claim '+f(u.p)+' SPC</button></div>';
x+='<div class="c"><b>Referral rules</b><p class="m">1. Share your link. 2. Your friend opens the app and joins the Official Channel. 3. Your friend starts mining or finishes one task. Then the referral is Successful and you get '+c.refrw+' SPC once. Until then it stays Pending. Self-referrals and fake accounts get nothing.</p><p class="m">Boost: each Successful referral adds +5% to your mining speed (max +100%). Now: +'+(S.bst||0)+'%.</p></div>';
if(u.r&&!u.c)x+='<div class="c"><b>Join to activate your referrer</b>'+String(c.ch).split(',').filter(Boolean).map(h=>'<p><a data-a="ol" data-l="https://t.me/'+esc(h.trim().replace('@',''))+'" style="color:var(--a)">'+esc(h.trim())+'</a></p>').join('')+'<button class="b" data-a="ck">Verify</button></div>';
x+=web();
const cs=(RFD&&RFD.cs)||[],ca=n=>{const r=cs.find(z=>z.lvl==n);return r?r.a:0};
x+='<div class="c"><b>Team commission</b><p class="m">You earn lifetime commission in SPC when people in your team buy stock or VIP/VVIP (with USDT or SPC). It is paid after the purchase is confirmed. Level 1 = '+c.cp1+'%, Level 2 = '+c.cp2+'%, Level 3 = '+c.cp3+'%.</p><div class="stat3"><div><span>Level 1</span><b>'+f(ca(1))+'</b></div><div><span>Level 2</span><b>'+f(ca(2))+'</b></div><div><span>Level 3</span><b>'+f(ca(3))+'</b></div></div>';
const ch=(RFD&&RFD.ch)||[];
x+=(ch.length?ch.map(h=>'<div class="r" style="border-bottom:1px solid var(--ln)"><span>Level '+h.lvl+' · '+(h.kd=='vip'?'VIP/VVIP':'Stock')+'<br><span class="m">'+new Date(h.ts).toLocaleString()+'</span></span><b style="color:var(--a)">+'+f(h.amt)+'</b></div>').join(''):'<p class="m">No commission yet.</p>')+'</div>';
const L=(RFD&&RFD.l)||[];
x+='<div class="c"><b>My referrals</b>'+(L.length?L.map(h=>'<div class="r" style="border-bottom:1px solid var(--ln)"><span>'+esc(h.n)+(h.un?' <span class="m">@'+esc(h.un)+'</span>':'')+'</span><b style="color:'+(h.st=='s'?'var(--a)':'var(--gd)')+'">'+(h.st=='s'?'Successful':'Pending')+'</b></div>').join(''):'<p class="m">No referrals yet.</p>')+'</div>';
return x}
function card(){const u=S.u,v=S.lv;
return '<div class="vcard'+(v?' v'+v:'')+'"><div class="sh"></div><div class="vr"><span class="vbrand">SPIDER COIN</span>'+(v?bdg(v):'<span class="vl">STANDARD</span>')+'</div><div class="vr"><svg viewBox="0 0 44 34" width="44" height="34"><rect width="44" height="34" rx="6" fill="#e5c76b"/><path d="M0 11h14M0 23h14M30 11h14M30 23h14M14 0v34M30 0v34" stroke="#9a7424" stroke-width="1.2" fill="none"/><rect x="14" y="9" width="16" height="16" rx="3" fill="none" stroke="#9a7424" stroke-width="1.2"/></svg><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#d9fbe9" stroke-width="2" stroke-linecap="round" opacity=".8"><path d="M8 8a6 6 0 010 8M12 5a10 10 0 010 14M16 2a14 14 0 010 20"/></svg></div><div><div class="vl">AVAILABLE BALANCE</div><div class="vamt">'+fm(u.b)+' <small style="font-size:13px;color:var(--gd)">SPC</small></div><div style="margin-top:4px;font-size:17px;font-weight:700;color:#f6dc8d;letter-spacing:.2px">'+uxs(u.b)+'</div></div><div class="vno">'+cno(u.id)+'</div><div class="vr"><div><div class="vl">CARD HOLDER</div><div class="vn">'+esc(u.n)+'</div></div><div><div class="vl">VISION 2037</div><div class="vn">'+(v?'LIFETIME':'MEMBER')+'</div></div><svg viewBox="0 0 48 30" width="48" height="30"><circle cx="17" cy="15" r="13" fill="#2dffa0" fill-opacity=".85"/><circle cx="31" cy="15" r="13" fill="#f0d27a" fill-opacity=".85"/></svg></div></div>'}
function tier(n,price,usdt,perks,v){const own=v>=n;return '<div class="tier t'+n+'"><div class="r" style="padding:0"><b style="font-size:19px;color:'+(n>1?'#7df0bd':'#f0d27a')+'">'+(n>1?'VVIP':'VIP')+'</b>'+bdg(n)+'</div><ul>'+perks.map(p=>'<li>✓ '+p+'</li>').join('')+'</ul>'+(own?'<button class="b" disabled>Active ✓</button>':'<button class="b'+(n<2?' gd':'')+'" data-a="bv" data-k="v'+n+'">Buy · '+fk(price)+' coins</button>')+'<p class="m" style="margin-top:6px">or '+usdt+' USDT (form below)</p></div>'}
function ux(n,rt){rt=String(rt||S.c.urt||'');const m=rt.match(new RegExp('^([0-9]+)(?:[.]([0-9]{1,10}))?$'));if(!m||typeof BigInt=='undefined')return '';const a=Math.abs(+n);if(!(a>0))return '0.00';const r10=BigInt(m[1]+((m[2]||'')+'0000000000').slice(0,10));const v=BigInt(Math.round(a*1e6))*r10/BigInt(1000000);if(v===BigInt(0))return '<0.0000000001';const s=v.toString().padStart(11,'0'),ip=s.slice(0,s.length-10);let fr=s.slice(s.length-10).replace(new RegExp('0+$'),'');while(fr.length<2)fr+='0';return (+n<0?'-':'')+Number(ip).toLocaleString('en-US')+'.'+fr}
function uxs(n,rt){const x=ux(n,rt);return x?'\u2248 '+x+' USDT':''}
function rateline(){return '<div class="m" style="text-align:center;margin:-4px 0 10px">1 SPC = <b>'+ux(1)+'</b> USDT</div>'}
function ratecard(){const x=[1,100,1000,10000].map(n=>'<span>'+fk(n)+' SPC = <b>'+ux(n)+'</b> USDT</span>').join('');return '<div class="c"><b>SPC rate</b><div class="m" style="display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:6px">'+x+'</div></div>'}
function homebal(){const u=S.u;return '<div class="c"><div class="r" style="padding:0"><span class="m">Your balance</span><b>'+fm(u.b)+' SPC</b></div><div class="m" style="text-align:right">'+uxs(u.b)+'</div></div>'+rateline()}
function comm(){const x=AD.cmx||{pool:0,un:0,pn:0,pa:0,ua:0};
return '<div class="c" data-f><b>Commission (paid in SPC from the pool)</b><p class="m">Percent of each stock or VIP/VVIP purchase made with USDT or SPC. Lifetime, 3 levels.</p><div class="g"><input name="cp1" inputmode="decimal" placeholder="Level 1 %" value="'+esc(AD.c.cp1)+'"><input name="cp2" inputmode="decimal" placeholder="Level 2 %" value="'+esc(AD.c.cp2)+'"><input name="cp3" inputmode="decimal" placeholder="Level 3 %" value="'+esc(AD.c.cp3)+'"></div><button class="b" data-a="ac">Save percentages</button></div>'
+'<div class="c" data-f><b>Commission pool</b><div class="stat3"><div><span>Pool</span><b>'+fk(Math.round(x.pool))+'</b></div><div><span>Paid</span><b>'+fk(Math.round(x.pa))+'</b></div><div><span>Unpaid</span><b>'+fk(Math.round(x.ua))+'</b></div></div><p class="m">Unpaid = the pool was empty or the supply cap was full ('+x.un+' records). Paid records: '+x.pn+'.</p><input name="amt" type="number" step="any" placeholder="Add SPC to the pool (use - to remove)"><button class="b" data-a="cf">Update pool</button></div>'}
function ratesupply(){const s=AD.sup||{total:1e10,cap:5e9,held:0},p=s.cap?s.held/s.cap*100:0;
return '<div class="c" data-f><b>SPC to USDT rate</b><p class="m">Price of 1 SPC in USDT, up to 10 decimals. Now: 1 SPC = '+esc(AD.c.urt)+' USDT</p><input name="urt" inputmode="decimal" value="'+esc(AD.c.urt)+'"><button class="b" data-a="ar">Save rate</button><div class="m" style="margin-top:6px">Old history keeps the rate it was made with.</div></div>'
+'<div class="c"><b>Supply</b><div class="stat3"><div><span>Total supply</span><b>'+fk(s.total)+'</b></div><div><span>Community cap</span><b>'+fk(s.cap)+'</b></div><div><span>Held now</span><b>'+fk(Math.round(s.held))+'</b></div></div><div class="m">Used '+p.toFixed(2)+'% \u00b7 Room left '+fk(Math.max(0,Math.round(s.cap-s.held)))+' SPC</div>'+(p>=90?'<div class="m" style="color:var(--rd)">Warning: over 90% of the community cap is used.</div>':p>=80?'<div class="m" style="color:var(--gd)">Notice: over 80% of the community cap is used.</div>':'')+'</div>'}
let CM=null,CMT=0;
function joinnote(){const hs=String(S.c.ch||'').split(',').map(h=>h.trim()).filter(Boolean);if(!hs.length)return '';
if(Date.now()-CMT>6e4){CMT=Date.now();api('cm').then(function(r){if(r){CM=r.m;render()}})}
if(CM===true)return '';
return '<div class="c" style="border-color:var(--gd)"><b>Official Channel is required</b><p class="m">You must join the Official Channel to send, receive and withdraw SPC.</p>'+hs.map(h=>'<button class="b" data-a="ol" data-l="https://t.me/'+esc(h.replace('@',''))+'">Join '+esc(h)+'</button>').join('')+'<p class="m">After joining, open this page again.</p></div>'}
function wallet(){const u=S.u,v=S.lv,K={mc:'Mining',task:'Task',referral:'Referral',sent:'Sent',received:'Received',promo:'Promo',vip:'VIP',withdraw:'Withdraw',commission:'Commission',refund:'Refund',story:'Story',admin:'Admin',stock:'Stock',farm:'Farm profit',bonus:'Welcome bonus'};
let x=card()+rateline()+'<div class="sg">'+[['s','Send'],['w','Withdraw'],['v','VIP'],['h','History']].map(t=>'<a data-a="ws" data-s="'+t[0]+'" class="'+(wsub==t[0]?'on':'')+'">'+t[1]+'</a>').join('')+'</div>';
if(wsub=='s'){x+=joinnote();
x+='<div class="c"><b>Your ID</b><div class="r"><span style="font-family:ui-monospace,monospace;font-size:18px;color:var(--a)">'+u.id+(u.un?'<br><span class="m">@'+esc(u.un)+'</span>':'')+'</span><button class="b" data-a="cp" data-l="'+u.id+'">Copy ID</button></div><p class="m">Share your ID so others can send you SPC.</p></div>';
x+='<div class="c" data-f><b>Send SPC</b><input name="to" placeholder="@username or Telegram ID" autocomplete="off"><input name="amt" type="number" step="any" placeholder="Amount (min '+S.c.mins+')"><button class="b" data-a="sd">Send</button><p class="m">The receiver must have opened the app once.</p></div>'}
else if(wsub=='w'){x+=joinnote();
x+=S.c.wd=='1'?'<div class="c" data-f><b>Withdraw</b><p class="m">Requests are reviewed and paid manually by an admin.'+(v>1?' VVIP: priority review.':'')+'</p><input name="amt" type="number" step="any" placeholder="Min '+S.c.minw+'"><input name="ad" placeholder="'+esc(S.c.wl)+'"><button class="b" data-a="wd">Withdraw</button></div>':'<div class="c" style="text-align:center;padding:30px 14px"><div style="font-size:36px">🔒</div><b style="font-size:17px;color:var(--gd)">Withdrawal Start in 2027</b></div>'}
else if(wsub=='v'){
x+=tier(1,S.c.vc,S.c.vp1,['Mining '+S.c.vr+' SPC/day','-'+S.c.disc+'% on coin promos','Gold VIP badge','Permanent'],v)+tier(2,S.c.vc2,S.c.vp2,['Everything in VIP','1 free 1k-visit promo every month','Priority withdrawal review','Premium VVIP badge'],v);
x+='<div class="c" data-f><b>Pay with USDT (BEP20)</b><select name="k"><option value="v1">VIP · '+S.c.vp1+' USDT</option><option value="v2">VVIP · '+S.c.vp2+' USDT</option></select><input name="tx" placeholder="USDT TX hash (0x...)"><p class="m">Send to this address:</p>'+dep(S.c.dep)+'<p class="m">Reviewed manually by an admin.</p><button class="b" data-a="vo">Submit USDT order</button></div>'}
else{const hs=HI||[];x+='<div class="c"><b>Wallet history</b>'+(hs.length?hs.map(h=>'<div class="r" style="border-bottom:1px solid var(--ln)"><span>'+(K[h.k]||esc(h.k))+(h.n?' · '+esc(h.n):'')+'<br><span class="m">'+new Date(h.ts).toLocaleString()+'</span></span><span style="text-align:right"><b style="color:'+(h.amt<0?'var(--rd)':'var(--a)')+'">'+(h.amt>0?'+':'')+f(h.amt)+'</b>'+(h.rt?'<br><span class="m">'+uxs(h.amt,h.rt)+'</span>':'')+'</span></div>').join(''):'<p class="m">No activity yet</p>')+'</div>'}
return x}
function board(){const B=BD||{lb:[],rm:[]};
return '<div class="c"><b>🏆 Top 100</b><p class="m">Ranked by VIP, referrals, then coins.</p>'+B.lb.map((r,i)=>'<div class="r" style="border-bottom:1px solid var(--ln)"><span><b>#'+(i+1)+'</b> '+esc(r.n)+bdg(r.lv,1)+'<br><span class="m">'+r.rc+' refs</span></span><b>'+f(r.b)+'</b></div>').join('')+'</div>'}
const dep=a=>a?'<div class="dep"><code>'+esc(a)+'</code><button class="b gd" data-a="cp" data-l="'+esc(a)+'">Copy</button></div>':'<p class="m">Deposit address coming soon</p>';
const cpf=t=>{const x=document.createElement('textarea');x.value=t;x.style.cssText='position:fixed;opacity:0;top:0';document.body.appendChild(x);x.select();try{document.execCommand('copy');toast('Copied ✓')}catch(e){toast('Copy failed')}x.remove()};
function exportSheet(rows){const TB=String.fromCharCode(9),NL=String.fromCharCode(10),CR=String.fromCharCode(13),H=['Telegram ID','Name','Username','Badge','Stocks','Free VVIP stock','Paid SPC','Paid USDT'],B=['Standard','VIP','VVIP'],cl=v=>String(v==null?'':v).split(TB).join(' ').split(NL).join(' ').split(CR).join(' ');
const R=rows.map(r=>[r.id,r.n,r.un?'@'+r.un:'',B[r.lv||0],r.stocks,r.fr?'Yes':'No',r.coins,r.usdt].map(cl));
const tsv=[H].concat(R).map(r=>r.join(TB)).join(NL),csv=[H].concat(R).map(r=>r.map(v=>'"'+v.split('"').join('""')+'"').join(',')).join(NL);
try{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='spc-farm-stock-holders.csv';document.body.appendChild(a);a.click();a.remove()}catch(e){}
try{navigator.clipboard.writeText(tsv).then(()=>toast('Copied '+rows.length+' rows - paste into Google Sheets ✓'),()=>cpf(tsv))}catch(e){cpf(tsv)}}
function wbc(){const w=S.wb;if(!w||!w.on||w.n>=7)return '';const dn=w.n+(w.t?0:1);
return '<div class="c wb"><div class="r" style="padding:0"><b>🎁 Welcome bonus</b><span class="m">Day '+Math.min(7,dn)+' of 7</span></div><div class="wbd">'+[1,2,3,4,5,6,7].map(i=>'<i class="'+(i<=w.n?'on':'')+'">'+i+'</i>').join('')+'</div><p class="m">Claim '+fk(w.rw)+' SPC every day during your first 7 days.'+(w.need>0?' Needs '+w.need+' verified referrals.':'')+'</p>'+(w.t?'<button class="b" disabled>Claimed today ✓</button>':'<button class="b gd" data-a="wb">Claim '+fk(w.rw)+' SPC</button>')+'</div>'}
function fhero(){const c=S.c,tt=+c.stt,ok=FM&&typeof FM=='object',sd=ok?FM.sold:null,left=ok?fk(Math.max(0,tt-sd)):'…',pc=ok?Math.min(100,sd/tt*100):0;
return '<div class="fh"><div class="fhb">🌾 SPC FARM STOCK</div><div class="fht">Farming investment · limited to '+fk(tt)+' stocks</div><div class="fpr"><div><span>PRICE</span><b>'+fk(c.spc)+' SPC</b></div><div><span>OR</span><b>'+c.spu+' USDT</b></div></div><div class="fbar"><i style="width:'+pc+'%"></i></div><div class="fst"><div><b>'+(ok?fk(sd):'…')+'</b><span>Sold</span></div><div><b>'+left+'</b><span>Available</span></div><div><b>'+fk(tt)+'</b><span>Total</span></div></div><div class="fv">VISION 2037<br>MISSION: ONE ACTION EVERY YEAR · UPDATE EVERY 3 MONTHS</div></div>'}
function fmy(){const k=S.sk||{n:0,fr:0},v=S.lv;
return '<div class="cert"><div class="vl" style="letter-spacing:2px;color:#d9c07a">YOUR STOCK HOLDINGS</div><div class="big">'+fk(k.n)+' <small style="font-size:14px">STOCK</small></div><div class="m">'+esc(S.u.n)+' · ID '+S.u.id+' '+bdg(v,1)+'</div>'+(v>1?(k.fr?'<p class="m" style="margin-top:8px">Free VVIP stock claimed ✓</p>':'<button class="b gd" data-a="ff">🎁 Claim your free VVIP stock</button>'):'<p class="m" style="margin-top:8px">VVIP members receive 1 free stock.</p>')+'</div>'}
function fmarket(){const m=FM&&typeof FM=='object'?FM:null;if(!m)return '<div class="c m">Loading market…</div>';
const en=m.en.slice().reverse(),mx=Math.max.apply(null,en.map(e=>e.pps).concat([1]));let ch='';
if(en.length){const w=300/Math.max(en.length,8),bw=w-4;ch='<svg viewBox="0 0 300 130" width="100%" style="display:block"><line x1="0" y1="65" x2="300" y2="65" stroke="#143826" stroke-width="1"/>'+en.map((e,i)=>{const h=Math.max(3,e.pps/mx*56),up=e.k=='p';return '<rect x="'+(i*w+2)+'" y="'+(up?65-h:65)+'" width="'+bw+'" height="'+h+'" rx="2" fill="'+(up?'#3ddc97':'#ff5470')+'"/>'}).join('')+'</svg>'}
else ch='<p class="m" style="text-align:center;padding:18px 0">No market entries yet.</p>';
return '<div class="c"><b>📊 Market dashboard</b><div class="mkst"><div><b>'+fk(m.holders)+'</b><span>Holders</span></div><div><b>'+fk(m.paid)+'</b><span>Paid (SPC)</span></div><div><b>'+m.en.length+'</b><span>Entries</span></div></div>'+ch+'<p class="m" style="text-align:center">▲ profit · ▼ loss (last '+en.length+' entries)</p>'+m.en.slice(0,10).map(e=>'<div class="r" style="border-top:1px solid var(--ln)"><span>'+(e.k=='p'?'<b class="pfu">▲ Profit</b>':'<b class="pfd">▼ Loss</b>')+' · '+fm(e.pps)+' per stock<br><span class="m">'+esc(e.nt||'')+' · '+new Date(e.ts).toLocaleDateString()+'</span></span>'+(e.k=='p'?'<span class="m">paid '+fk(e.tot)+'</span>':'')+'</div>').join('')+'</div>'}
function fbuy(){const c=S.c;return '<div class="c" data-f><b>Buy SPC Farm Stock</b><p class="m">1 stock = '+fk(c.spc)+' SPC ('+uxs(c.spc)+') or '+c.spu+' USDT. Max 1000 per order.</p><input name="q" type="number" min="1" step="1" value="1" inputmode="numeric"><button class="b gd" data-a="fb">Buy with SPC coins</button><div style="height:12px"></div><b>Pay with USDT (BEP20)</b><p class="m">Send the exact USDT amount to:</p>'+dep(c.dep)+'<input name="tx" placeholder="USDT TX hash (0x...)"><button class="b" data-a="fu">Submit USDT order</button><p class="m">USDT orders are reviewed manually. Stock is credited after admin approval and an invoice is generated.</p></div>'}
function fsend(){return '<div class="c" data-f><b>Send stock</b><p class="m">Transfer stocks to another member like coins. They must have opened the app once.</p><input name="to" placeholder="@username or Telegram ID" autocomplete="off"><input name="q" type="number" min="1" step="1" placeholder="Quantity" inputmode="numeric"><button class="b" data-a="xs">Send stock</button></div>'}
function finv(){if(!FI||typeof FI!='object')return '<div class="c m">Loading…</div>';const K={buy:'Bought',free:'Free VVIP stock',sent:'Sent',recv:'Received'},st={a:'PAID',p:'PENDING',x:'REJECTED'};
return '<div class="c"><b>🧾 Invoices</b><p class="m">Download a branded PDF invoice for every approved stock purchase.</p>'+(FI.iv.length?FI.iv.map(i=>'<div class="r" style="border-top:1px solid var(--ln)"><span><b>'+esc(i.no)+'</b><br><span class="m">'+i.q+' stock · '+fm(i.tot)+' '+esc(i.cu)+' · '+new Date(i.ts).toLocaleDateString()+'</span><br><span class="chp '+i.st+'">'+st[i.st]+'</span></span>'+(i.st=='a'?'<button class="b gd" data-a="inv" data-no="'+esc(i.no)+'">PDF</button>':'')+'</div>').join(''):'<p class="m">No invoices yet.</p>')+'</div><div class="c"><b>Stock activity</b>'+(FI.sl.length?FI.sl.map(x=>'<div class="r" style="border-top:1px solid var(--ln)"><span>'+(K[x.k]||esc(x.k))+(x.n?' · '+esc(x.n):'')+'<br><span class="m">'+new Date(x.ts).toLocaleString()+'</span></span><b class="'+(x.k=='sent'?'pfd':'pfu')+'">'+(x.k=='sent'?'-':'+')+fk(x.q)+'</b></div>').join(''):'<p class="m">No activity yet</p>')+'</div>'}
function frules(){return '<div class="c"><b>📜 Stock rules</b><div class="rules" style="margin-top:8px">'+(S.c.str?esc(S.c.str):'Rules will be published by the admin.')+'</div></div>'}
function farm(){const TT=[['m','Market'],['b','Buy'],['s','Send'],['i','Invoices'],['r','Rules']];
return fhero()+fmy()+'<div class="sg">'+TT.map(t=>'<a data-a="fs" data-s="'+t[0]+'" class="'+(fsub==t[0]?'on':'')+'">'+t[1]+'</a>').join('')+'</div>'+({m:fmarket,b:fbuy,s:fsend,i:finv,r:frules})[fsub]()+'<div class="disc"><b>Disclaimer:</b> SPC Farm Stock is a voluntary community investment. You take part entirely by your own free choice. Profit is not guaranteed and market values can go up or down. Due to technical reasons or any project problem, no individual or the project team is liable for any profit or loss.</div>'}
function ld(){if(tab=='w'&&wsub=='h'&&!HI){HI=[];api('hi').then(r=>{if(r){HI=r.h;render()}else HI=null})}else if(tab=='b'&&!BD){BD={lb:[],rm:[]};api('lb').then(r=>{if(r){BD=r;render()}else BD=null})}else if(tab=='f'){if(!FM){FM=1;api('fm').then(r=>{FM=r?r.mk:null;if(r)render()})}if(fsub=='i'&&!FI){FI=1;api('fi').then(r=>{FI=r||null;if(r)render()})}}}
let LG=null;
function errlog(){
let h='<div class="c"><b>Error Logs</b><p class="m">App v'+VER+'. Shows the latest problems with time, user and line number. Line numbers come from the deployed file and can differ a little.</p>';
if(LG===null){h+='<button class="b" data-a="lg">Load logs</button>'}
else{
h+='<div class="r"><button class="b" data-a="lg">Refresh</button><button class="b x" data-a="lc">Clear all</button><button class="b" data-a="lt">Test error</button></div>';
if(!LG.length)h+='<p class="m">No errors recorded.</p>';
LG.forEach(function(e){
const sk=String(e.stk||''),mt=sk.match(new RegExp('([A-Za-z0-9_./-]+):([0-9]+):([0-9]+)'));
let ln='';
if(e.src=='client'){const c0=sk.split(String.fromCharCode(10))[0].match(new RegExp('^@([0-9]+):([0-9]+)'));if(c0&&+c0[1])ln='Page script line '+c0[1]+':'+c0[2]+' (about worker.js line '+(+c0[1]+558)+')'}
else if(mt){const fn=sk.match(new RegExp('at (?:async )?([A-Za-z0-9_.<>]+)'));ln='Line '+mt[2]+':'+mt[3]+' ('+mt[1]+')'+(fn?' in '+fn[1]:'')}
h+='<div style="border-top:1px solid var(--ln);padding:8px 0;word-break:break-word"><div><b>'+esc(e.src)+'</b> · '+esc(e.act||'-')+' · x'+e.n+'</div><div class="m">'+new Date(+e.ls).toLocaleString()+(e.u?' · user '+e.u:'')+'</div><div>'+esc(e.msg)+'</div>'+(ln?'<div class="m">'+esc(ln)+'</div>':'')+(sk?'<details><summary class="m">Details</summary><pre style="white-space:pre-wrap;font-size:11px;color:var(--mu)">'+esc(sk)+'</pre></details>':'')+'</div>'
})}
return h+'</div>'}
function admin(){if(!AD||!AD.c){if(!AD){AD=1;act('al')}return '<p class="m">Loading…</p>'}
const has=r=>AD.im||AD.rl.indexOf(r)>-1,RL=[['cfg','Settings'],['tk','Tasks'],['us','Users'],['wd','Withdrawals'],['od','Orders'],['st','Stock'],['lg','Error Logs'],['rt','Rates & Supply'],['cm','Commission']];
const bt=(a,id,ok,t,x)=>'<button class="b'+(x?' x':'')+'" data-a="'+a+'" data-id="'+id+'" data-ok="'+ok+'">'+t+'</button>';
const cks=sel=>RL.map(r=>'<label class="ck"><input type="checkbox" value="'+r[0]+'"'+(sel.indexOf(r[0])>-1?' checked':'')+'>'+r[1]+'</label>').join('');
let x='<div class="c"><b>🛠 Admin</b> <span class="m">App v'+VER+' · Users: '+AD.n+' · '+(AD.im?'Main Admin':'Roles: '+AD.rl.join(', '))+'</span></div>';
if(has('cfg'))x+='<div class="c" data-f><b>Settings</b>'+Object.keys(L).map(k=>'<span class="m">'+L[k]+'</span><input name="'+k+'" value="'+esc(AD.c[k])+'">').join('')+'<button class="b" data-a="as">Save</button></div>';
if(has('tk')){x+='<div class="c"><b>Daily tasks (max 10)</b>'+AD.tk.filter(k=>!k.o&&k.st=='a').map(k=>'<div data-f style="border-bottom:1px solid var(--ln);padding:6px 0"><input name="url" value="'+esc(k.url)+'"><input name="bl" maxlength="24" placeholder="Button label (e.g. Visit Channel)" value="'+esc(k.bl||'')+'"><input name="rw" type="number" step="any" value="'+k.rw+'"><div class="g"><button class="b" data-a="ae" data-id="'+k.id+'">Save</button>'+bt('ad',k.id,'','Delete',1)+'</div></div>').join('')+'<div data-f><input name="url" placeholder="https://..."><input name="bl" maxlength="24" placeholder="Button label (e.g. Visit Channel)"><input name="rw" type="number" step="any" placeholder="Reward (default '+esc(AD.c.dtr)+')"><button class="b" data-a="at">Add task</button></div></div>';
x+='<div class="c"><b>Promo orders</b>'+AD.tk.filter(k=>k.o).map(k=>'<div class="r"><span>'+esc(k.url)+'<br><span class="m">owner '+k.o+' · left '+k.l+(k.st=='p'?' · '+esc(k.x):'')+'</span></span>'+(k.st=='p'?bt('ap',k.id,'1','✓')+bt('ap',k.id,'','✕',1):bt('ad',k.id,'','✕',1))+'</div>').join('')+'</div>'}
if(has('od'))x+='<div class="c"><b>VIP orders</b>'+AD.od.map(o=>'<div class="r"><span>'+o.u+' · '+o.k+'<br><span class="m">'+esc(o.tx)+'</span></span>'+bt('ao',o.id,'1','✓')+bt('ao',o.id,'','✕',1)+'</div>').join('')+'</div>';
if(has('wd'))x+='<div class="c"><b>Withdraw requests</b>'+AD.w.map(w=>'<div class="r"><span>'+w.u+(w.lv>1?' VVIP':w.lv?' VIP':'')+' · '+f(w.amt)+'<br><span class="m">'+esc(w.ad)+'</span></span>'+bt('aw',w.id,'1','✓')+bt('aw',w.id,'','✕',1)+'</div>').join('')+'</div>';
if(has('us')){const U=AD.usr;x+='<div class="c"><b>Users</b><div data-f><input name="s" placeholder="Telegram ID or @username"><button class="b" data-a="au">Find</button></div>'+(U?'<p>'+esc(U.n)+' · '+U.id+(U.un?' · @'+esc(U.un):'')+'<br>Balance '+f(U.b)+(U.bn?' · BLOCKED':'')+(U.isa?' · ADMIN':'')+'</p><div data-f><input name="amt" type="number" step="any" placeholder="+/- SPC"><div class="g"><button class="b" data-a="ag" data-id="'+U.id+'">Adjust</button><button class="b x" data-a="ab" data-id="'+U.id+'" data-on="'+(U.bn?'':'1')+'">'+(U.bn?'Unblock':'Block')+'</button></div></div>':'')+'</div>'}
if(has('st')){x+='<div class="c" data-f><b>📈 Post market entry</b><p class="m">Profit pays coins to every holder instantly (stocks x amount). Loss is shown on the dashboard only.</p><select name="kd"><option value="p">Profit (pays coins)</option><option value="l">Loss (display only)</option></select><input name="pps" type="number" step="any" placeholder="Coins per stock"><input name="nt" placeholder="Note (visible to everyone)"><button class="b gd" data-a="sp">Post entry</button></div>';
x+='<div class="c"><b>Stock USDT orders</b>'+AD.so.map(o=>'<div class="r"><span>'+esc(o.nm||o.u)+' · ID '+o.u+'<br><span class="m">'+o.q+' stock · '+fm(o.tot)+' USDT<br>'+esc(o.tx)+'</span></span><button class="b" data-a="so" data-no="'+esc(o.no)+'" data-ok="1">✓</button><button class="b x" data-a="so" data-no="'+esc(o.no)+'" data-ok="">✕</button></div>').join('')+'</div>';
x+='<div class="c" data-f><b>Stock rules (visible to all)</b><textarea name="str" rows="7" placeholder="Write the stock rules here...">'+esc(AD.c.str)+'</textarea><button class="b" data-a="sq">Save rules</button></div>'}
if(has('rt'))x+=ratesupply();
if(has('cm'))x+=comm();
if(has('lg'))x+=errlog();
if(AD.im){x+='<div class="c"><b>Stock holders sheet</b><p class="m">Name, numeric ID, badge, stocks and amount paid. Downloads a CSV and copies a table you can paste into Google Sheets.</p><button class="b gd" data-a="sx">Export holders</button></div>';
x+='<div class="c"><b>Admins and roles</b><div class="r"><span>'+AD.main+' · Main Admin (all roles)</span></div>'+AD.ad.filter(z=>String(z.id)!=String(AD.main)).map(z=>'<div data-f style="border-top:1px solid var(--ln);padding:8px 0"><div class="r" style="padding:0"><b>'+z.id+'</b><button class="b x" data-a="aa" data-id="'+z.id+'" data-on="">Remove</button></div>'+cks(String(z.rl||'').split(','))+'<button class="b" data-a="aa" data-id="'+z.id+'" data-on="1">Save roles</button></div>').join('')+'<div data-f style="border-top:1px solid var(--ln);padding-top:8px"><input name="id" type="number" placeholder="Telegram numeric ID">'+cks(['cfg','tk','us','wd','od','st'])+'<button class="b" data-a="aa" data-on="1">Add admin</button></div></div>'}
return x}
function render(){const u=S.u;
$('app').innerHTML='<header><div class="av">'+esc(Array.from(u.n||'?')[0])+'</div><div class="tt"><b>'+esc(u.n)+bdg(S.lv,1)+'</b><span>ID '+u.id+(u.un?' · @'+esc(u.un):'')+'</span></div>'+(S.adm?'<div class="gr" data-a="tab" data-t="'+(tab=='a'?'h':'a')+'">'+(tab=='a'?CLOSE:GEAR)+'</div>':'')+'</header><div class="pg">'+({h:home,t:tasks,f:farm,r:refer,b:board,w:wallet,a:admin})[tab]()+'</div>';
const IC={f:'<path d="M12 21v-9M12 12c-4 0-6-2-6-6 4 0 6 2 6 6zM12 14c0-4 2-6 6-6 0 4-2 6-6 6z"/>',h:'<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',t:'<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',r:'<circle cx="10" cy="8" r="3.5"/><path d="M3.5 20v-1a4 4 0 014-4h5a4 4 0 014 4v1"/>',b:'<path d="M5 20V10M12 20V4M19 20v-7"/>',w:'<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M16 13h2"/>',a:'<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>'};
const tb=[['h','Home'],['t','Tasks'],['f','Farm'],['r','Refer'],['b','Ranking'],['w','Wallet']];
$('nav').innerHTML=tb.map(t=>'<a data-a="tab" data-t="'+t[0]+'" class="'+(tab==t[0]?'on':'')+'"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+IC[t[0]]+'</svg>'+t[1]+'</a>').join('');
const bl=$('bal');if(bl){if(pb!==null&&pb!=u.b){const a0=+pb,t0=performance.now(),to=+u.b,st=t=>{const k=Math.min(1,(t-t0)/600);bl.textContent=f(a0+(to-a0)*k);if(k<1)requestAnimationFrame(st)};requestAnimationFrame(st)}pb=u.b}ld()}
document.onclick=e=>{const b=e.target.closest('[data-a]');if(!b)return;try{T.HapticFeedback.impactOccurred('light')}catch(e){}const d=Object.assign({},b.dataset),a=d.a,F=b.closest('[data-f]');
if(F)F.querySelectorAll('input,select,textarea').forEach(i=>{if(i.name)d[i.name]=i.value});
if(a=='aa'&&F)d.rl=[].slice.call(F.querySelectorAll('input[type=checkbox]:checked')).map(i=>i.value).join(',');
if(a=='tab'){tab=d.t;render();const p=$('app');p.classList.remove('fi');void p.offsetWidth;p.classList.add('fi')}
else if(a=='v'){const l=d.url;if(l.indexOf('t.me/')>-1)T.openTelegramLink(l);else T.openLink(l);act('ts',{t:d.t})}
else if(a=='sv'){try{T.shareToStory(S.c.sm,{text:'Mine Spider Coin with me!',widget_link:{url:'https://t.me/'+S.bot+'?startapp=r'+S.u.id,name:'Spider Coin'}})}catch(e){}act('ss')}
else if(a=='lg'||a=='lc'||a=='lt'){(a=='lt'?api('lt').then(function(){return api('lg')}):api(a)).then(function(r){if(r&&r.lg){LG=r.lg;render()}})}
else if(a=='cp'){try{navigator.clipboard.writeText(d.l).then(()=>toast('Copied ✓'),()=>cpf(d.l))}catch(e){cpf(d.l)}}
else if(a=='sh')T.openTelegramLink('https://t.me/share/url?url='+encodeURIComponent(d.l)+'&text='+encodeURIComponent('Mine Spider Coin with me!'));
else if(a=='ol')T.openTelegramLink(d.l);else if(a=='ws'){wsub=d.s;render()}else if(a=='fs'){fsub=d.s;render()}else if(a=='inv'){const url=location.origin+'/invoice?i='+encodeURIComponent(T.initData)+'&n='+encodeURIComponent(d.no);try{if(T.downloadFile&&T.isVersionAtLeast&&T.isVersionAtLeast('8.0'))T.downloadFile({url:url,file_name:d.no+'.pdf'});else T.openLink(url)}catch(e){T.openLink(url)}}else if(a=='sp'){const go=()=>act('sp',d);if(T.showConfirm)T.showConfirm('Post this entry? A profit entry pays coins to all stock holders immediately and cannot be undone.',ok=>{if(ok)go()});else go()}else act(a,d)};
setInterval(()=>{const m=$('mn');if(m&&S){const u=S.u,v=u.mst?Math.min(Date.now()+off-u.mst,864e5)*S.er/864e5:0;m.textContent=v.toFixed(6);const b=$('cb');if(b)b.disabled=v<+S.c.minc;const p=Math.min(1,v/+S.c.minc),g=$('rg');if(g)g.style.strokeDashoffset=553*(1-p);const pc=$('pc');if(pc)pc.textContent=u.mst?Math.floor(p*100)+'% to claim':'SPC mined'}},100);
setInterval(()=>{if(S&&tab=='t'&&(S.tk.some(k=>k.s&&!k.dc&&Date.now()+off-k.s<S.c.secs*1e3+1e3)||S.u.ss&&Date.now()+off-S.u.ss<S.c.secs*1e3+1e3))render()},1000);
let CE=0;
function rep(m,l,c,st){if(CE>=5||!T.initData)return;CE++;try{fetch('/api',{method:'POST',body:JSON.stringify({i:T.initData,a:'ce',m:String(m||'').slice(0,300),l:l|0,c:c|0,st:String(st||'').slice(0,700),t:tab})}).catch(function(){})}catch(e){}}
window.addEventListener('error',function(e){if(e.filename&&e.filename.indexOf(location.origin)!==0)return;rep(e.message,e.lineno,e.colno,e.error&&e.error.stack)});
window.addEventListener('unhandledrejection',function(e){const r=e.reason;rep(r&&r.message||String(r),0,0,r&&r.stack)});
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
// NOTE: USDT payments (VIP, Promo, Stock) and withdrawals are NOT verified on-chain.
//       They are stored as pending and require manual admin approval.
// =====================================================================
