// functions/index.js
//
// One callable function, invoked right after a relevant Firestore write
// (new request -> email the dentist, accept/decline -> email the student).
//
// SECURITY NOTE: this function does NOT trust a client-supplied
// to/subject/html. It only accepts a { type, requestId } pair, then uses
// the Admin SDK to read the actual shadowing_requests document and verify
// the caller is genuinely a participant in it (the student who created it,
// or the dentist it was sent to) before deciding who to email and what to
// say. This is what stops any logged-in user from calling this function
// directly to send arbitrary email to arbitrary addresses "from" your
// verified domain.
//
// Setup (requires the Blaze plan, already enabled):
//   cd functions && npm install
//   firebase functions:secrets:set RESEND_API_KEY
//   firebase deploy --only functions
//
// Get a free Resend API key at https://resend.com (no credit card required
// for the free tier). Any SMTP/REST email provider works the same way —
// just swap the sendViaResend() body below if you'd rather use SendGrid,
// Mailgun, etc.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const FROM_EMAIL = "PreDentTX <notifications@predenttx.com>"; // requires predenttx.com to be verified in Resend (Domains tab)

// Same escaping rule as the client: any text a user typed (their message,
// the dentist's note) gets escaped before it's embedded in an HTML email,
// so it can't be used to inject markup into the email body.
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function sendViaResend(to, subject, html) {
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
    console.error(`[sendViaResend] Resend rejected the request (status ${resendResponse.status}): ${JSON.stringify(data)}`);
    throw new HttpsError("internal", data.message || "Email provider rejected the request.");
  }

  return data;
}

exports.sendNotificationEmail = onCall({ secrets: [RESEND_API_KEY] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in to trigger a notification.");
  }

  const callerUid = request.auth.uid;
  const { type, requestId } = request.data || {};

  if (!type || !requestId) {
    throw new HttpsError("invalid-argument", "Missing type/requestId.");
  }

  const reqSnap = await db.collection("shadowing_requests").doc(requestId).get();
  if (!reqSnap.exists) {
    console.error(`[sendNotificationEmail] Request not found: ${requestId}`);
    throw new HttpsError("not-found", "Request not found.");
  }
  const reqData = reqSnap.data();
  const safeDate = escapeHtml(reqData.requestedDate);

  console.log(`[sendNotificationEmail] type=${type} requestId=${requestId} callerUid=${callerUid}`);

  if (type === "new_request") {
    // Only the student who actually owns this request can trigger this —
    // and it only ever goes to the real dentist on that same request.
    if (reqData.studentId !== callerUid) {
      console.error(`[sendNotificationEmail] permission-denied: caller=${callerUid} studentId=${reqData.studentId}`);
      throw new HttpsError("permission-denied", "Not authorized for this request.");
    }

    const dentistSnap = await db.collection("users").doc(reqData.dentistId).get();
    const dentistEmail = dentistSnap.exists ? dentistSnap.data().email : null;
    if (!dentistEmail) {
      console.error(`[sendNotificationEmail] Dentist email not found for dentistId=${reqData.dentistId}, dentistDoc exists=${dentistSnap.exists}`);
      throw new HttpsError("not-found", "Dentist email not found.");
    }

    console.log(`[sendNotificationEmail] Sending new_request email to ${dentistEmail}`);
    const result = await sendViaResend(
      dentistEmail,
      `New shadowing request — ${safeDate}`,
      `<p><strong>${escapeHtml(reqData.studentEmail)}</strong> requested to shadow on <strong>${safeDate}</strong>.</p>
       <p>Message: ${escapeHtml(reqData.studentMessage) || "(none)"}</p>
       <p>Log in to PreDentTX to accept or decline.</p>`
    );
    console.log(`[sendNotificationEmail] Resend response: ${JSON.stringify(result)}`);
    return result;
  }

  if (type === "accepted" || type === "declined") {
    // Only the dentist who actually owns this request can trigger this —
    // and it only ever goes to the real student on that same request.
    if (reqData.dentistId !== callerUid) {
      console.error(`[sendNotificationEmail] permission-denied: caller=${callerUid} dentistId=${reqData.dentistId}`);
      throw new HttpsError("permission-denied", "Not authorized for this request.");
    }

    const studentEmail = reqData.studentEmail;
    if (!studentEmail) {
      console.error(`[sendNotificationEmail] Student email missing on request ${requestId}`);
      throw new HttpsError("not-found", "Student email not found.");
    }

    console.log(`[sendNotificationEmail] Sending ${type} email to ${studentEmail}`);

    if (type === "accepted") {
      return sendViaResend(
        studentEmail,
        "Your shadowing request was accepted!",
        `<p>Your request for <strong>${safeDate}</strong> was <strong>accepted</strong>.</p>
         <p>${reqData.dentistMessage ? "Instructions: " + escapeHtml(reqData.dentistMessage) : ""}</p>
         <p>Log in to PreDentTX for full details.</p>`
      );
    }

    return sendViaResend(
      studentEmail,
      "Update on your shadowing request",
      `<p>Your request for <strong>${safeDate}</strong> was declined.</p>
       <p>Log in to PreDentTX to find other clinics.</p>`
    );
  }

  throw new HttpsError("invalid-argument", "Unknown notification type.");
});
