import GhostAdminAPI from "@tryghost/admin-api";

if (!process.env.GHOST_ADMIN_URL || !process.env.GHOST_ADMIN_API_KEY) {
  throw new Error("Missing required environment variables");
}

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || ""; // e.g. https://socialswing.blog
const api = new GhostAdminAPI({
  url: process.env.GHOST_ADMIN_URL, // https://socialswing.blog
  key: process.env.GHOST_ADMIN_API_KEY, // Admin API Key (Integration)
  version: "v5",
});

export default async function handler(req, res) {
  // CORS
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Credentials", "false");

  if (req.method === "OPTIONS") return res.status(204).end();

  // Basic Referer allowlist (extra defense)
  const referer = req.headers.referer || "";
  if (!referer.startsWith(ALLOW_ORIGIN)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { action, slug, memberEmail } = req.body || {};
    if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
      return res.status(400).json({ error: "Invalid slug" });
    }
    if (!memberEmail || !/^[^@]+@[^@]+\.[^@]+$/.test(memberEmail)) {
      return res.status(400).json({ error: "Invalid memberEmail" });
    }
    const label = `liked:festival:${slug}`.toLowerCase();

    // Read member by email via Admin API
    const member = await api.members
      .read({ email: memberEmail })
      .catch(() => null);
    if (!member) return res.status(404).json({ error: "Member not found" });

    const current = member.labels || [];
    const names = current.map((l) => (l.name || "").toLowerCase());
    const has = names.includes(label);

    let nextLabels = current;
    if (action === "unlike") {
      // remove if present
      nextLabels = current.filter(
        (l) => (l.name || "").toLowerCase() !== label
      );
    } else {
      // like = add if missing
      nextLabels = has ? current : [...current, { name: label }];
    }

    // Only save if changed
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

    return res.json({
      success: true,
      liked: action === "unlike" ? false : true,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Server error" });
  }
}
