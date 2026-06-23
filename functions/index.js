const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const FROM_EMAIL = "PreDentTX <notifications@predenttx.com>";

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

exports.weeklyDigest = onSchedule(
  { schedule: "every monday 14:00", timeZone: "America/Chicago", secrets: [RESEND_API_KEY] },
  async () => {
    console.log("[weeklyDigest] Starting weekly digest run");
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const usersSnap = await db.collection("users").where("role", "==", "student").get();
    const cityMap = {};

    usersSnap.forEach(d => {
      const data = d.data();
      if (data.email && data.preferredCity) {
        const city = data.preferredCity.trim().toLowerCase();
        if (!cityMap[city]) cityMap[city] = [];
        cityMap[city].push({ email: data.email, firstName: data.firstName || "Student" });
      }
    });

    const cities = Object.keys(cityMap);
    if (cities.length === 0) {
      console.log("[weeklyDigest] No students with saved city — skipping");
      return;
    }

    for (const city of cities) {
      const recipients = cityMap[city];
      const prefixEnd = city + "\uf8ff";

      const clinicsSnap = await db.collection("dentist_profiles")
        .where("city", ">=", city).where("city", "<=", prefixEnd).get();
      const newClinics = clinicsSnap.docs.filter(d => (d.data().updatedAt || "") >= oneWeekAgo);

      const eventsSnap = await db.collection("events")
        .where("city", ">=", city).where("city", "<=", prefixEnd).get();
      const upcomingEvents = eventsSnap.docs.filter(d => {
        const ev = d.data();
        return ev.eventDate && ev.eventDate.toDate() >= new Date();
      });

      if (newClinics.length === 0 && upcomingEvents.length === 0) {
        console.log(`[weeklyDigest] Nothing new in ${city} — skipping`);
        continue;
      }

      const clinicLines = newClinics.map(d => {
        const c = d.data();
        return `<li><strong>${c.clinicName || "Clinic"}</strong> — ${c.specialty || "General Dentistry"} &nbsp;<a href="https://predenttx.com/dentist-profile.html?id=${d.id}" style="color:#0A5C36;">View →</a></li>`;
      }).join("");

      const eventLines = upcomingEvents.map(d => {
        const ev = d.data();
        const dateStr = ev.eventDate ? ev.eventDate.toDate().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "";
        return `<li><strong>${ev.title || "Event"}</strong> — ${dateStr}</li>`;
      }).join("");

      const html = `
        <div style="font-family:'Segoe UI',sans-serif; max-width:560px; margin:0 auto;">
          <div style="background:#0A5C36; padding:24px 30px; border-radius:8px 8px 0 0;">
            <h1 style="color:#D4AF37; margin:0; font-size:24px;">PreDentTX Weekly</h1>
            <p style="color:white; margin:6px 0 0 0; font-size:14px;">What's new in ${city.charAt(0).toUpperCase() + city.slice(1)} this week</p>
          </div>
          <div style="background:white; padding:24px 30px; border:1px solid #eee; border-radius:0 0 8px 8px;">
            ${newClinics.length > 0 ? `<h2 style="color:#0A5C36; font-size:17px;">🦷 New or Updated Clinics</h2><ul>${clinicLines}</ul>` : ""}
            ${upcomingEvents.length > 0 ? `<h2 style="color:#0A5C36; font-size:17px;">📅 Upcoming Events</h2><ul>${eventLines}</ul>` : ""}
            <div style="margin-top:24px; text-align:center;">
              <a href="https://predenttx.com" style="background:#0A5C36; color:white; padding:12px 28px; border-radius:6px; text-decoration:none; font-weight:bold;">Go to PreDentTX →</a>
            </div>
            <p style="font-size:12px; color:#aaa; margin-top:20px;">You're receiving this because you have a PreDentTX account with a saved city. Log in to update your city preference.</p>
          </div>
        </div>
      `;

      for (const recipient of recipients) {
        try {
          await sendViaResend(recipient.email, `PreDentTX Weekly — What's new in ${city.charAt(0).toUpperCase() + city.slice(1)}`, html);
          console.log(`[weeklyDigest] Sent to ${recipient.email}`);
        } catch (err) {
          console.error(`[weeklyDigest] Failed for ${recipient.email}: ${err.message}`);
        }
      }
    }

    console.log("[weeklyDigest] Done");
  }
);
