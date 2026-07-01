// Vercel Serverless Function
// Receives lead data from the website form and forwards it to the ecore CRM REST API.
// Credentials are read from environment variables (set in Vercel Project Settings),
// never exposed to the client.

const CRM_BASE = "https://finsion.ecore.ch/api/v1";

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ success: false, message: "Method not allowed" });
    return;
  }

  const email = process.env.CRM_EMAIL;
  const password = process.env.CRM_PASSWORD;

  if (!email || !password) {
    res.status(500).json({ success: false, message: "CRM credentials not configured" });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = {};
    }
  }
  body = body || {};

  const firstName = (body.firstName || "").trim();
  const lastName = (body.lastName || "").trim();

  if (!isNonEmptyString(firstName) || !isNonEmptyString(lastName)) {
    res.status(400).json({ success: false, message: "firstName and lastName are required" });
    return;
  }

  const gender = body.gender === "weiblich" ? "weiblich" : "männlich";

  const notesParts = [];
  if (body.kaufpreis) notesParts.push(`Kaufpreis: CHF ${body.kaufpreis}`);
  if (body.eigenkapital) notesParts.push(`Eigenkapital: CHF ${body.eigenkapital}`);
  if (body.bemerkungen) notesParts.push(`Bemerkungen: ${body.bemerkungen}`);

  const leadPayload = {
    customerType: "Privat",
    gender,
    firstName,
    lastName,
    source: "Direkte Kundenanfrage",
  };

  if (isNonEmptyString(body.email)) leadPayload.email = body.email.trim();
  if (isNonEmptyString(body.telefon)) leadPayload.phone1 = body.telefon.trim();
  if (isNonEmptyString(body.plz)) leadPayload.addressZip = body.plz.trim();
  if (isNonEmptyString(body.ort)) leadPayload.addressCity = body.ort.trim();
  if (notesParts.length > 0) leadPayload.note = notesParts.join(" | ");

  let token;
  try {
    const loginResp = await fetch(`${CRM_BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const loginData = await loginResp.json();
    if (!loginResp.ok || !loginData.success || !loginData.token) {
      res.status(502).json({ success: false, message: "CRM login failed" });
      return;
    }
    token = loginData.token;
  } catch (e) {
    res.status(502).json({ success: false, message: "CRM login request failed" });
    return;
  }

  try {
    const leadResp = await fetch(`${CRM_BASE}/leads`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(leadPayload),
    });
    const leadData = await leadResp.json();

    // Best-effort logout, don't block the response on it.
    fetch(`${CRM_BASE}/logout`, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    }).catch(() => {});

    if (!leadResp.ok || !leadData.success) {
      res.status(502).json({ success: false, message: leadData.message || "CRM lead creation failed" });
      return;
    }

    res.status(200).json({ success: true, id: leadData.id });
  } catch (e) {
    res.status(502).json({ success: false, message: "CRM lead request failed" });
  }
};
