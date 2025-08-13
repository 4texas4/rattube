// api/proxy.js
// Drop this into a Vercel project under /api/proxy.js
// Usage: /api/proxy?url=<encodeURIComponent(targetUrl)>

const ALLOWED_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "i.ytimg.com",
  "s.ytimg.com"
]);

/**
 * Simple host whitelist check. Returns true if host (or its parent) is in whitelist.
 */
function hostAllowed(host) {
  if (!host) return false;
  // make host lowercase and strip port if present
  host = host.toLowerCase().split(":")[0];
  if (ALLOWED_HOSTS.has(host)) return true;
  // allow subdomains of allowed hosts, e.g. r1---sn-*.googlevideo.com is NOT allowed by default
  for (const allowed of ALLOWED_HOSTS) {
    if (host === allowed) return true;
    if (host.endsWith("." + allowed)) return true;
  }
  return false;
}

export default async function handler(req, res) {
  try {
    const target = req.query.url || req.url.replace(/^\/api\/proxy/, '').replace(/^\?/, '');
    if (!target) {
      res.status(400).send("Missing url parameter. Use /api/proxy?url=<encoded url>");
      return;
    }

    // decode target if needed
    const decoded = Array.isArray(target) ? target[0] : target;
    let targetUrl;
    try {
      targetUrl = decodeURIComponent(decoded);
    } catch (err) {
      targetUrl = decoded;
    }

    // Basic URL parse & whitelist check
    let urlObj;
    try {
      urlObj = new URL(targetUrl);
    } catch (err) {
      res.status(400).send("Invalid URL");
      return;
    }

    if (!hostAllowed(urlObj.hostname)) {
      res.status(403).send("Target host not allowed by proxy.");
      return;
    }

    // Build fetch options: accept GET only for safety
    if (req.method !== "GET") {
      res.status(405).setHeader("Allow", "GET").send("Only GET supported");
      return;
    }

    // Forward some headers to mimic a browser (helps YouTube give full HTML)
    const headers = {
      "User-Agent": req.headers["user-agent"] || "Mozilla/5.0",
      Accept: req.headers["accept"] || "text/html,*/*",
      // Accept-Language can help YouTube respond consistently
      "Accept-Language": req.headers["accept-language"] || "en-US,en;q=0.9",
      // don't forward cookies by default
    };

    // Perform fetch
    const fetchRes = await fetch(urlObj.toString(), { method: "GET", headers, redirect: "follow" });

    // Copy status and key headers
    res.status(fetchRes.status);

    // Content-Type passthrough
    const contentType = fetchRes.headers.get("content-type");
    if (contentType) res.setHeader("Content-Type", contentType);

    // CORS: allow your frontend origin(s). Using * is simplest during dev.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    // Optional: cache-control hint (Vercel edge may cache). Adjust as needed.
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");

    // Stream body to client
    const body = fetchRes.body;
    if (body && typeof body.pipe === "function") {
      body.pipe(res);
    } else if (body) {
      // Node fetch might provide a ReadableStream in some runtimes; handle fallback
      const buf = await fetchRes.arrayBuffer();
      res.send(Buffer.from(buf));
    } else {
      res.send("");
    }
  } catch (err) {
    console.error("proxy error:", err);
    res.status(500).send("Proxy error");
  }
}
