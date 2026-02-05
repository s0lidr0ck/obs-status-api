import express from "express";

const app = express();
// If behind a reverse proxy (EasyPanel/Traefik/Nginx), this makes req.ip honor X-Forwarded-For
app.set("trust proxy", true);
app.use(express.json());
// Some pushers use application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: false }));

const BUILD_ID = process.env.BUILD_ID || "dev";

const MAX_EVENTS = Number(process.env.MAX_EVENTS || 200);
const events = [];
function recordEvent(evt) {
  events.push({ ts: new Date().toISOString(), ...evt });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}
function normalizeFeed(feed) {
  return String(feed ?? "").trim().toUpperCase();
}

// CORS (helps for any cross-origin use)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

let latest = {
  updated: new Date().toISOString(),
  values: {
    ASN: { ou: 0, updated: null },
    PUP: { ou: 0, updated: null },
    BACKUP: { ou: 0, updated: null },
    PRST: { ou: 0, updated: null }
  }
};

app.get("/", (req, res) => res.send(`OK OVERLAY BUILD v1 (${BUILD_ID})`));

app.get("/routes", (req, res) => {
  res.json({
    ok: true,
    routes: [
      "/status (GET, POST)",
      "/updates?limit=50&feed=PRST",
      "/overlay/asn",
      "/overlay/pup",
      "/overlay/backup",
      "/overlay/prst"
    ]
  });
});

app.get("/status", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ build: "overlay-v1", buildId: BUILD_ID, ...latest });
});

app.get("/updates/summary", (req, res) => {
  res.set("Cache-Control", "no-store");
  const byFeed = {};
  for (const e of events) {
    const f = e.feed || "(empty)";
    if (!byFeed[f]) {
      byFeed[f] = {
        total: 0,
        applied: 0,
        ignored: 0,
        lastTs: null,
        lastOu: null,
        lastRawFeed: null,
        lastIp: null,
        lastXff: null,
        lastUa: null
      };
    }
    byFeed[f].total += 1;
    if (e.applied) byFeed[f].applied += 1;
    else byFeed[f].ignored += 1;
    byFeed[f].lastTs = e.ts;
    byFeed[f].lastOu = e.ou ?? null;
    byFeed[f].lastRawFeed = e.rawFeed ?? null;
    byFeed[f].lastIp = e.ip ?? null;
    byFeed[f].lastXff = e.xff ?? null;
    byFeed[f].lastUa = e.ua ?? null;
  }
  res.json({
    build: "overlay-v1",
    buildId: BUILD_ID,
    serverTime: new Date().toISOString(),
    maxEvents: MAX_EVENTS,
    counts: {
      totalEvents: events.length
    },
    byFeed,
    latest
  });
});

// Inspect recent incoming updates for debugging (in-memory, last MAX_EVENTS)
app.get("/updates", (req, res) => {
  res.set("Cache-Control", "no-store");
  const limit = Math.min(Number(req.query.limit || 50) || 50, MAX_EVENTS);
  const feedFilter = req.query.feed ? normalizeFeed(req.query.feed) : null;
  const out = feedFilter
    ? events.filter((e) => e.feed === feedFilter)
    : events.slice();
  res.json({
    build: "overlay-v1",
    buildId: BUILD_ID,
    serverTime: new Date().toISOString(),
    maxEvents: MAX_EVENTS,
    latest,
    events: out.slice(-limit).reverse()
  });
});

app.post("/status", (req, res) => {
  const now = new Date().toISOString();

  const reqMeta = {
    ip: req.ip,
    xff: req.get("x-forwarded-for") || null,
    ua: req.get("user-agent") || null
  };

  const applied = [];
  const ignored = [];

  if (req.body?.values && typeof req.body.values === "object") {
    for (const [rawFeed, val] of Object.entries(req.body.values)) {
      const feed = normalizeFeed(rawFeed);
      const ouNum = Number(val);
      const ok = Boolean(latest.values[feed]);

      recordEvent({
        type: "bulk",
        ...reqMeta,
        feed,
        rawFeed: String(rawFeed),
        ou: ouNum,
        applied: ok
      });

      if (!ok) {
        ignored.push({ feed, rawFeed: String(rawFeed) });
        continue;
      }

      latest.values[feed] = { ou: ouNum, updated: now };
      applied.push(feed);
    }
    latest.updated = now;
    return res.json({ ok: true, applied, ignored });
  }

  const rawFeed = req.body?.feed ?? req.query?.feed;
  const feed = normalizeFeed(rawFeed);
  const ouNum = Number(req.body?.ou ?? req.query?.ou);
  const ok = Boolean(latest.values[feed]);

  recordEvent({
    type: "single",
    ...reqMeta,
    feed,
    rawFeed: rawFeed == null ? null : String(rawFeed),
    ou: ouNum,
    applied: ok
  });

  if (ok) {
    latest.values[feed] = { ou: ouNum, updated: now };
    latest.updated = now;
    applied.push(feed);
  } else {
    ignored.push({ feed, rawFeed: rawFeed == null ? null : String(rawFeed) });
  }

  res.json({ ok: true, applied, ignored });
});

function overlayHtml(feed) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta http-equiv="Cache-Control" content="no-store"/>
  <style>
    body{
      margin:0;
      width:960px;
      height:540px;
      background:rgba(0,0,0,0);
      font-family: Arial, sans-serif;
      display:flex;
      justify-content:flex-end;
      align-items:flex-start;
      padding:18px 18px;
      box-sizing:border-box;
    }
    #v{
      font-weight:900;
      font-size:64px;
      /* Stronger shadow + subtle outline so it stays readable on bright video */
      text-shadow:
        0 3px 14px rgba(0,0,0,0.95),
        0 0 2px rgba(0,0,0,0.95);
      -webkit-text-stroke: 2px rgba(0,0,0,0.85);
      /* More opaque backdrop + optional blur (where supported) */
      background:rgba(0,0,0,0.82);
      backdrop-filter: blur(6px);
      border-radius:14px;
      padding:10px 16px;
      display:inline-block;
      color:rgba(255,255,255,0.92);
      animation:none;
      border:1px solid rgba(255,255,255,0.12);
    }
    @keyframes pulse{
      0%{transform:scale(1);}
      50%{transform:scale(1.10);}
      100%{transform:scale(1);}
    }
  </style>
</head>
<body>
  <div id="v">--</div>
  <script>
    const FEED = "${feed}";
    const POLL_MS = 5000;

    function fmt(n){
      if(!Number.isFinite(n)) return "--";
      if(n>0) return "+"+n;
      return ""+n;
    }
    function strength(abs){
      // Keep a high minimum opacity for readability on light backgrounds
      if(abs>=60) return 1.0;
      if(abs>=45) return 0.95;
      if(abs>=30) return 0.90;
      if(abs>=15) return 0.85;
      return 0.80;
    }
    function setVal(n){
      const el=document.getElementById("v");
      if(!Number.isFinite(n)){
        el.textContent="--";
        el.style.color="rgba(255,255,255,0.92)";
        el.style.animation="none";
        return;
      }
      el.textContent=fmt(n);
      const abs=Math.abs(n);
      const op=strength(abs);

      // Over = RED, Under = GREEN
      if(n>0) el.style.color="rgba(255,60,60,"+op+")";
      else if(n<0) el.style.color="rgba(46,204,113,"+op+")";
      else el.style.color="rgba(255,255,255,0.85)";

      el.style.animation = (abs>=60) ? "pulse 1.2s ease-in-out infinite" : "none";
    }

    async function refresh(){
      try{
        // Same-origin fetch; should not need CORS
        const r=await fetch("/status?_="+Date.now(), { cache:"no-store" });
        const j=await r.json();
        setVal(Number(j?.values?.[FEED]?.ou));
      }catch(e){
        setVal(NaN);
      }
    }
    refresh();
    setInterval(refresh, POLL_MS);
  </script>
</body>
</html>`;
}

function sendOverlay(res, feed) {
  // Force a CSP that allows what we need:
  // - inline script (OBS Browser Source often needs it)
  // - same-origin fetch
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline';"
  );
  res.setHeader("Cache-Control", "no-store");
  res.type("html").send(overlayHtml(feed));
}

app.get("/overlay/asn", (req, res) => sendOverlay(res, "ASN"));
app.get("/overlay/pup", (req, res) => sendOverlay(res, "PUP"));
app.get("/overlay/backup", (req, res) => sendOverlay(res, "BACKUP"));
app.get("/overlay/prst", (req, res) => sendOverlay(res, "PRST"));

app.listen(8080, "0.0.0.0", () => console.log("Status API running on 8080"));

