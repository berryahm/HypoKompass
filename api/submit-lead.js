// Vercel Serverless Function
// Receives lead data from the website form and forwards it to the ecore CRM REST API.
// Credentials are read from environment variables (set in Vercel Project Settings),
// never exposed to the client.

const CRM_BASE = "https://finsion.ecore.ch/api/v1";
const INVISIBLE_CHARS_RE = /[\u200B-\u200D\uFEFF\u00A0\u2060]/g;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

// Strips invisible/zero-width unicode characters before checking for real content,
// so a field can't "look" filled while actually being blank.
function hasVisibleContent(v) {
  return typeof v === "string" && v.replace(INVISIBLE_CHARS_RE, "").trim().length > 0;
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
  const leadEmail = (body.email || "").trim();
  const telefon = (body.telefon || "").trim();

  if (!hasVisibleContent(firstName) || !hasVisibleContent(lastName)) {
    res.status(400).json({ success: false, message: "firstName and lastName are required" });
    return;
  }

  // A lead nobody can reach is worthless - require at least one real contact method.
  const hasValidEmail = hasVisibleContent(leadEmail) && EMAIL_RE.test(leadEmail);
  const hasValidPhone = hasVisibleContent(telefon) && telefon.replace(/[^0-9]/g, "").length >= 9;
  if (!hasValidEmail && !hasValidPhone) {
    res.status(400).json({ success: false, message: "A valid email or phone number is required" });
    return;
  }

  const gender = body.gender === "weiblich" ? "weiblich" : "männlich";

  const notesParts = [];
  if (body.kaufpreis) notesParts.push(`Kaufpreis: CHF ${body.kaufpreis}`);
  if (body.eigenkapital) notesParts.push(`Eigenkapital: CHF ${body.eigenkapital}`);
  if (body.einkommen) notesParts.push(`Jahreseinkommen: CHF ${body.einkommen}`);
  if (body.bemerkungen) notesParts.push(`Bemerkungen: ${body.bemerkungen}`);

  const leadPayload = {
    customerType: "Privat",
    gender,
    firstName,
    lastName,
    source: "Direkte Kundenanfrage",
  };

  if (hasValidEmail) leadPayload.email = leadEmail;
  if (hasValidPhone) leadPayload.phone1 = telefon;
  if (isNonEmptyString(body.plz)) leadPayload.addressZip = body.plz.trim();
  if (isNonEmptyString(body.ort)) leadPayload.addressCity = body.ort.trim();

  const yob = parseInt(body.geburtsjahr, 10);
  const currentYear = new Date().getFullYear();
  if (!isNaN(yob) && yob >= 1900 && yob <= currentYear) leadPayload.yob = yob;

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
