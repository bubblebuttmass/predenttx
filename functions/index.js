// functions/index.js
//
// One callable function, invoked directly from the browser client right
// after a relevant Firestore write (new request -> email the dentist,
// accept/decline -> email the student). No Firestore-triggered extension
// needed for this app's scale.
//
// Setup (requires the Blaze plan, already enabled):
//   cd functions && npm install
//   firebase functions:secrets:set RESEND_API_KEY
//   firebase deploy --only functions
//
// Get a free Resend API key at https://resend.com (no credit card required
// for the free tier). Any SMTP/REST email provider works the same way —
// just swap the fetch() call below if you'd rather use SendGrid, Mailgun, etc.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

admin.initializeApp();

const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const FROM_EMAIL = "PreDentTX <onboarding@resend.dev>"; // swap once you verify your own domain in Resend

exports.sendNotificationEmail = onCall({ secrets: [RESEND_API_KEY] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in to trigger a notification.");
  }

  const { to, subject, html } = request.data || {};
  if (!to || !subject || !html) {
    throw new HttpsError("invalid-argument", "Missing to/subject/html.");
  }

  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY.value()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });

  const data = await resendResponse.json();

  if (!resendResponse.ok) {
    throw new HttpsError("internal", data.message || "Email provider rejected the request.");
  }

  return data;
});
