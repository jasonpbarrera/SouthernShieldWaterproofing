const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";
const DEFAULT_COMPANY = "Southern Shield Waterproofing";
const DEFAULT_EMAIL = "info@southernshieldwaterproofing.com";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getField(body, ...keys) {
  if (!body || typeof body !== "object") return "";
  const lowerMap = {};
  for (const [k, v] of Object.entries(body)) {
    lowerMap[k.toLowerCase()] = v;
  }
  for (const key of keys) {
    const val = lowerMap[key.toLowerCase()];
    if (val !== undefined && val !== null) {
      return String(val).trim();
    }
  }
  return "";
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function handleLeadSubmission(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON payload." }, 400);
  }

  if (!body || typeof body !== "object") {
    return jsonResponse({ error: "Invalid JSON payload." }, 400);
  }

  // 1. Server-side honeypot check: silently return 200 OK if filled by a bot
  const honeypot = getField(body, "honeypot", "botHoneypot");
  if (honeypot) {
    return jsonResponse({ status: "ok" }, 200);
  }

  // 2. Required field validation
  const name = getField(body, "name");
  const email = getField(body, "email");
  const phone = getField(body, "phone", "phoneNumber");
  const message = getField(body, "message");

  if (!name || !email || !phone || !message) {
    return jsonResponse(
      { error: "Name, Email, Phone, and Message are required." },
      400
    );
  }

  const companyName = getField(body, "companyName") || DEFAULT_COMPANY;
  const preferredContact = getField(body, "preferredContactMethod") || "Not specified";
  const serviceType = getField(body, "serviceType", "service") || "General Inquiry";
  const preferredStartDate = getField(body, "preferredStartDate") || "N/A";

  const brevoApiKey = (env.BREVO_API_KEY || "").trim();
  const recipientEmail = (env.LEAD_NOTIFICATION_EMAIL || DEFAULT_EMAIL).trim();
  const senderEmail = (env.BREVO_SENDER_EMAIL || DEFAULT_EMAIL).trim();

  if (!brevoApiKey) {
    console.error("Missing BREVO_API_KEY secret.");
    return jsonResponse({ error: "Email notification service is not configured." }, 500);
  }

  const htmlContent = `
    <h2>New Website Inquiry — ${escapeHtml(companyName)}</h2>
    <table style="border-collapse:collapse;font-family:sans-serif;">
      <tr><td style="padding:6px 12px;font-weight:bold;">Name:</td><td style="padding:6px 12px;">${escapeHtml(name)}</td></tr>
      <tr><td style="padding:6px 12px;font-weight:bold;">Phone:</td><td style="padding:6px 12px;">${escapeHtml(phone)}</td></tr>
      <tr><td style="padding:6px 12px;font-weight:bold;">Email:</td><td style="padding:6px 12px;">${escapeHtml(email)}</td></tr>
      <tr><td style="padding:6px 12px;font-weight:bold;">Preferred Contact:</td><td style="padding:6px 12px;">${escapeHtml(preferredContact)}</td></tr>
      <tr><td style="padding:6px 12px;font-weight:bold;">Service Needed:</td><td style="padding:6px 12px;">${escapeHtml(serviceType)}</td></tr>
      <tr><td style="padding:6px 12px;font-weight:bold;">Preferred Start Date:</td><td style="padding:6px 12px;">${escapeHtml(preferredStartDate)}</td></tr>
      <tr><td style="padding:6px 12px;font-weight:bold;">Message:</td><td style="padding:6px 12px;">${escapeHtml(message)}</td></tr>
    </table>
  `;

  const brevoPayload = {
    sender: { name: companyName, email: senderEmail },
    to: [{ email: recipientEmail, name: companyName }],
    subject: `New Inquiry from ${name} (${serviceType})`,
    htmlContent,
  };

  if (email.includes("@")) {
    brevoPayload.replyTo = { email, name };
  }

  const brevoResp = await fetch(BREVO_API_URL, {
    method: "POST",
    headers: {
      "api-key": brevoApiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(brevoPayload),
  });

  if (!brevoResp.ok) {
    const errText = await brevoResp.text().catch(() => "");
    console.error(`Brevo API error (${brevoResp.status}): ${errText}`);
    return jsonResponse({ error: "Failed to deliver inquiry notification." }, 502);
  }

  return jsonResponse({ status: "saved", id: crypto.randomUUID() }, 201);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === "www.southernshieldwaterproofing.com") {
      url.hostname = "southernshieldwaterproofing.com";
      return Response.redirect(url.toString(), 301);
    }

    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/api/leads") {
      return handleLeadSubmission(request, env);
    }

    if (path.startsWith("/api/")) {
      return jsonResponse({ error: "Not found." }, 404);
    }

    return env.ASSETS.fetch(request);
  },
};
