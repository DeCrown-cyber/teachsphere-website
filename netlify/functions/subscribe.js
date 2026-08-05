// netlify/functions/subscribe.js
//
// Handles newsletter subscriptions:
//  - Validates the submitted email
//  - Checks Airtable for an existing subscriber with the same email
//  - Adds new subscribers with Email / Date / Source
//
// Requires these environment variables to be set in Netlify:
//   AIRTABLE_BASE_ID   -> your Airtable base id (e.g. app3QCj2vaZATNmuL)
//   AIRTABLE_TOKEN     -> a personal access token with read/write access to the base
//
// Expects the Airtable table to be named "Subscribers" with fields:
//   Email    (Single line text or Email field) — primary field
//   Date     (Date field)
//   Source   (Single line text) — add this field in Airtable before deploying
// Adjust TABLE_NAME / field names below if your Airtable schema differs.

const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const TABLE_NAME = "Subscribers";
const AIRTABLE_API_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE_NAME)}`;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function jsonResponse(statusCode, bodyObj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(bodyObj),
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return jsonResponse(200, { ok: true });
  }

  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  if (!AIRTABLE_BASE_ID || !AIRTABLE_TOKEN) {
    console.error("Missing AIRTABLE_BASE_ID or AIRTABLE_TOKEN environment variables");
    return jsonResponse(500, { error: "Server is not configured correctly. Please try again later." });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (err) {
    return jsonResponse(400, { error: "Invalid request." });
  }

  const rawEmail = (payload.email || "").toString().trim();
  const source = (payload.source || "Website Newsletter").toString().trim();

  if (!rawEmail) {
    return jsonResponse(400, { error: "Please enter your email address." });
  }
  if (!EMAIL_RE.test(rawEmail)) {
    return jsonResponse(400, { error: "Please enter a valid email address." });
  }

  const email = rawEmail.toLowerCase();

  const airtableHeaders = {
    Authorization: `Bearer ${AIRTABLE_TOKEN}`,
    "Content-Type": "application/json",
  };

  try {
    const filterFormula = `LOWER({Email}) = "${email.replace(/"/g, '\\"')}"`;
    const lookupUrl = `${AIRTABLE_API_URL}?filterByFormula=${encodeURIComponent(filterFormula)}&maxRecords=1`;

    const lookupRes = await fetch(lookupUrl, { headers: airtableHeaders });

    if (!lookupRes.ok) {
      const errText = await lookupRes.text();
      console.error("Airtable lookup failed:", lookupRes.status, errText);
      return jsonResponse(502, { error: "Could not reach the subscription service. Please try again." });
    }

    const lookupData = await lookupRes.json();

    if (lookupData.records && lookupData.records.length > 0) {
      return jsonResponse(409, {
        duplicate: true,
        message: "This email is already subscribed.",
      });
    }

    const today = new Date().toISOString().slice(0, 10);

    const createRes = await fetch(AIRTABLE_API_URL, {
      method: "POST",
      headers: airtableHeaders,
      body: JSON.stringify({
        records: [
          {
            fields: {
              Email: email,
              Date: today,
              Source: source,
            },
          },
        ],
      }),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      console.error("Airtable create failed:", createRes.status, errText);
      return jsonResponse(502, { error: "Could not save your subscription. Please try again." });
    }

    return jsonResponse(200, { success: true });
  } catch (err) {
    console.error("Unexpected error in subscribe function:", err);
    return jsonResponse(500, { error: "Something went wrong. Please try again in a moment." });
  }
};
