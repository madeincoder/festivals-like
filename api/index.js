// api/index.js (ESM)
import GhostAdminAPI from "@tryghost/admin-api";

const send = (res, status, obj) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
};

export default async function handler(req, res) {
  const URL = process.env.GHOST_ADMIN_URL || "";
  const KEY = process.env.GHOST_ADMIN_API_KEY || "";
  const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || ""; // e.g. https://socialswing.blog

  // --- CORS ---
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return send(res, 204, {});

  // Env guard (return JSON instead of crashing)
  if (!URL || !KEY || !ALLOW_ORIGIN) {
    return send(res, 500, {
      error: "Server misconfigured: missing env vars",
      missing: {
        GHOST_ADMIN_URL: !!URL,
        GHOST_ADMIN_API_KEY: !!KEY,
        ALLOW_ORIGIN: !!ALLOW_ORIGIN,
      },
    });
  }

  // Optional: Referer allowlist (browser will set this)
  const referer = req.headers.referer || "";
  if (!referer.startsWith(ALLOW_ORIGIN)) {
    return send(res, 403, { error: "Forbidden (bad referer)" });
  }

  if (req.method !== "POST") {
    return send(res, 405, { error: "Method Not Allowed" });
  }

  // Parse JSON body safely (Vercel usually gives parsed body already)
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }
  if (!body || typeof body !== "object") {
    return send(res, 400, { error: "Invalid JSON body" });
  }

  const { action, slug, memberEmail } = body;
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    return send(res, 400, { error: "Invalid slug" });
  }
  if (!memberEmail || !/^[^@]+@[^@]+\.[^@]+$/.test(memberEmail)) {
    return send(res, 400, { error: "Invalid memberEmail" });
  }

  const label = `liked:festival:${slug}`.toLowerCase();
  const api = new GhostAdminAPI({ url: URL, key: KEY, version: "v5" });

  try {
    const member = await api.members
      .read({ email: memberEmail })
      .catch(() => null);
    if (!member) return send(res, 404, { error: "Member not found" });

    const current = member.labels || [];
    const names = current.map((l) => (l.name || "").toLowerCase());
    const has = names.includes(label);

    let nextLabels;
    if (action === "unlike") {
      nextLabels = current.filter(
        (l) => (l.name || "").toLowerCase() !== label
      );
    } else {
      nextLabels = has ? current : [...current, { name: label }];
    }

    // Idempotent save
    const changed =
      nextLabels.length !== current.length ||
      nextLabels.some(
        (l, i) =>
          (l.name || "").toLowerCase() !==
          (current[i]?.name || "").toLowerCase()
      );

    if (changed) {
      await api.members.edit({ id: member.id, labels: nextLabels });
    }

    return send(res, 200, {
      success: true,
      liked: action === "unlike" ? false : true,
    });
  } catch (e) {
    console.error("[like-festival] fatal", e);
    return send(res, 500, { error: "Server error" });
  }
}
