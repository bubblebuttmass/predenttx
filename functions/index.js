// functions/index.js
//
// One callable function that handles every email notification in the app —
// shadowing requests, logged hours, and event/job applications, in both
// directions (student -> host, and host -> student).
//
// SECURITY NOTE: this function does NOT trust a client-supplied recipient
// or message. The client only ever sends { type, docId }. "type" is looked
// up against a fixed whitelist (NOTIFICATION_CONFIG below) that's baked
// into this server code, not provided by the client — so a client can't
// invent a new type or point an existing type at a different collection.
// For each request, the function reads the real Firestore document with
// the Admin SDK, verifies the caller is genuinely the student or host on
// that specific record, and only then builds the email and sends it. This
// is what stops any logged-in user from using this function to email
// someone they have no real relationship to.
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

// Any text a user typed (a message, a clinic name, a job title) gets
// escaped before it's embedded in an HTML email, so it can't be used to
// inject markup into the email body.
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

// Every notification type the app can trigger. "collection" is which
// Firestore collection docId refers to. "hostField" is the field name that
// holds the dentist/host's uid on that collection (it's "dentistId" on the
// older shadowing collections, "hostId" on the newer event/job ones).
// "direction" controls which side is allowed to trigger it and which side
// receives it: studentToHost means only the student on the doc can call
// it, and it goes to the host's email; hostToStudent is the reverse.
const NOTIFICATION_CONFIG = {
  new_request: {
    collection: "shadowing_requests", hostField: "dentistId", direction: "studentToHost",
    subject: (d) => `New shadowing request — ${escapeHtml(d.requestedDate)}`,
    body: (d) => `<p><strong>${escapeHtml(d.studentEmail)}</strong> requested to shadow on <strong>${escapeHtml(d.requestedDate)}</strong>.</p>
                  <p>Message: ${escapeHtml(d.studentMessage) || "(none)"}</p>
                  <p>Log in to PreDentTX to accept or decline.</p>`
  },
  accepted: {
    collection: "shadowing_requests", hostField: "dentistId", direction: "hostToStudent",
    subject: () => "Your shadowing request was accepted!",
    body: (d) => `<p>Your request for <strong>${escapeHtml(d.requestedDate)}</strong> was <strong>accepted</strong>.</p>
                  <p>${d.dentistMessage ? "Instructions: " + escapeHtml(d.dentistMessage) : ""}</p>
                  <p>Log in to PreDentTX for full details.</p>`
  },
  declined: {
    collection: "shadowing_requests", hostField: "dentistId", direction: "hostToStudent",
    subject: () => "Update on your shadowing request",
    body: (d) => `<p>Your request for <strong>${escapeHtml(d.requestedDate)}</strong> was declined.</p>
                  <p>Log in to PreDentTX to find other clinics.</p>`
  },
  hours_logged: {
    collection: "shadowing_logs", hostField: "dentistId", direction: "studentToHost",
    subject: (d) => `Hours submitted for review — ${escapeHtml(d.clinicName) || "your clinic"}`,
    body: (d) => `<p><strong>${escapeHtml(d.studentEmail)}</strong> logged <strong>${d.hours}</strong> ${escapeHtml(d.category || "shadowing")} hours on ${escapeHtml(d.logDate)}.</p>
                  <p>Log in to PreDentTX to approve or deny.</p>`
  },
  hours_approved: {
    collection: "shadowing_logs", hostField: "dentistId", direction: "hostToStudent",
    subject: () => "Your logged hours were approved",
    body: (d) => `<p>Your <strong>${d.hours}</strong> ${escapeHtml(d.category || "shadowing")} hours on ${escapeHtml(d.logDate)} at ${escapeHtml(d.clinicName) || "the clinic"} were approved.</p>`
  },
  hours_denied: {
    collection: "shadowing_logs", hostField: "dentistId", direction: "hostToStudent",
    subject: () => "Update on your logged hours",
    body: (d) => `<p>Your <strong>${d.hours}</strong> ${escapeHtml(d.category || "shadowing")} hours on ${escapeHtml(d.logDate)} at ${escapeHtml(d.clinicName) || "the clinic"} were not approved this time. Log in to PreDentTX for details.</p>`
  },
  event_application: {
    collection: "event_applications", hostField: "hostId", direction: "studentToHost",
    subject: (d) => `New application — ${escapeHtml(d.eventTitle) || "your event"}`,
    body: (d) => `<p><strong>${escapeHtml(d.studentEmail)}</strong> applied to <strong>${escapeHtml(d.eventTitle)}</strong>.</p>
                  <p>Message: ${escapeHtml(d.message) || "(none)"}</p>
                  <p>Log in to PreDentTX to review.</p>`
  },
  event_application_accepted: {
    collection: "event_applications", hostField: "hostId", direction: "hostToStudent",
    subject: (d) => `Your application was accepted — ${escapeHtml(d.eventTitle) || ""}`,
    body: (d) => `<p>Your application to <strong>${escapeHtml(d.eventTitle)}</strong> was accepted. Log in to PreDentTX for details.</p>`
  },
  event_application_declined: {
    collection: "event_applications", hostField: "hostId", direction: "hostToStudent",
    subject: (d) => `Update on your application — ${escapeHtml(d.eventTitle) || ""}`,
    body: (d) => `<p>Your application to <strong>${escapeHtml(d.eventTitle)}</strong> was declined.</p>`
  },
  job_application: {
    collection: "job_applications", hostField: "hostId", direction: "studentToHost",
    subject: (d) => `New applicant — ${escapeHtml(d.jobTitle) || "your job listing"}`,
    body: (d) => `<p><strong>${escapeHtml(d.studentEmail)}</strong> applied for <strong>${escapeHtml(d.jobTitle)}</strong>.</p>
                  <p>Message: ${escapeHtml(d.message) || "(none)"}</p>
                  <p>Log in to PreDentTX to review.</p>`
  },
  job_application_accepted: {
    collection: "job_applications", hostField: "hostId", direction: "hostToStudent",
    subject: (d) => `Good news about your application — ${escapeHtml(d.jobTitle) || ""}`,
    body: (d) => `<p>Your application for <strong>${escapeHtml(d.jobTitle)}</strong> was accepted. Log in to PreDentTX for details.</p>`
  },
  job_application_declined: {
    collection: "job_applications", hostField: "hostId", direction: "hostToStudent",
    subject: (d) => `Update on your application — ${escapeHtml(d.jobTitle) || ""}`,
    body: (d) => `<p>Your application for <strong>${escapeHtml(d.jobTitle)}</strong> was declined.</p>`
  },
};

exports.sendNotificationEmail = onCall({ secrets: [RESEND_API_KEY] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in to trigger a notification.");
  }

  const callerUid = request.auth.uid;
  const { type, docId } = request.data || {};
  const config = NOTIFICATION_CONFIG[type];

  if (!config || !docId) {
    console.error(`[sendNotificationEmail] Invalid request: type=${type} docId=${docId}`);
    throw new HttpsError("invalid-argument", "Missing or unknown type/docId.");
  }

  const docSnap = await db.collection(config.collection).doc(docId).get();
  if (!docSnap.exists) {
    console.error(`[sendNotificationEmail] ${config.collection}/${docId} not found`);
    throw new HttpsError("not-found", "Record not found.");
  }
  const d = docSnap.data();
  const hostId = d[config.hostField];

  let recipientEmail;
  if (config.direction === "studentToHost") {
    if (d.studentId !== callerUid) {
      console.error(`[sendNotificationEmail] permission-denied (studentToHost): caller=${callerUid} studentId=${d.studentId}`);
      throw new HttpsError("permission-denied", "Not authorized for this record.");
    }
    const hostSnap = await db.collection("users").doc(hostId).get();
    recipientEmail = hostSnap.exists ? hostSnap.data().email : null;
  } else {
    if (hostId !== callerUid) {
      console.error(`[sendNotificationEmail] permission-denied (hostToStudent): caller=${callerUid} hostId=${hostId}`);
      throw new HttpsError("permission-denied", "Not authorized for this record.");
    }
    recipientEmail = d.studentEmail;
  }

  if (!recipientEmail) {
    console.error(`[sendNotificationEmail] No recipient email found for type=${type} doc=${config.collection}/${docId}`);
    throw new HttpsError("not-found", "Recipient email not found.");
  }

  console.log(`[sendNotificationEmail] type=${type} doc=${config.collection}/${docId} -> ${recipientEmail}`);
  const result = await sendViaResend(recipientEmail, config.subject(d), config.body(d));
  console.log(`[sendNotificationEmail] Resend response: ${JSON.stringify(result)}`);
  return result;
});
