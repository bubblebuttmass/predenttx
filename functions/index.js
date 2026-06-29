const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const FROM_EMAIL = "PreDentTX <notifications@predenttx.com>";

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

async function sendViaResend(to, subject, html) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY.value()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error(`[sendViaResend] Failed (${res.status}): ${JSON.stringify(data)}`);
    throw new Error(data.message || "Email send failed");
  }
  return data;
}

function emailWrapper(title, subtitle, bodyHtml) {
  return `
    <div style="font-family:'Segoe UI',sans-serif; max-width:560px; margin:0 auto;">
      <div style="background:#0A5C36; padding:24px 30px; border-radius:8px 8px 0 0;">
        <h1 style="color:#D4AF37; margin:0; font-size:22px;">${title}</h1>
        ${subtitle ? `<p style="color:white; margin:6px 0 0 0; font-size:14px;">${subtitle}</p>` : ""}
      </div>
      <div style="background:white; padding:24px 30px; border:1px solid #eee; border-radius:0 0 8px 8px;">
        ${bodyHtml}
        <p style="font-size:12px; color:#aaa; margin-top:24px;">PreDentTX &mdash; predenttx.com</p>
      </div>
    </div>
  `;
}

exports.onApplicationCreated = onDocumentCreated(
  { document: "applications/{appId}", secrets: [RESEND_API_KEY] },
  async (event) => {
    const app = event.data.data();
    const appId = event.params.appId;
    console.log(`[onApplicationCreated] appId=${appId} jobId=${app.jobId}`);

    const jobSnap = await db.collection("job_listings").doc(app.jobId).get();
    if (!jobSnap.exists) { console.error("[onApplicationCreated] Job listing not found"); return; }
    const job = jobSnap.data();

    if (job.employerEmail && app.resumeUrl) {
      try {
        await sendViaResend(
          job.employerEmail,
          `New application for ${job.title} via PreDentTX`,
          emailWrapper(
            "New Application",
            `Via PreDentTX &mdash; ${escapeHtml(job.title)}`,
            `
              <p><strong>Position:</strong> ${escapeHtml(job.title)} at ${escapeHtml(job.employer)}</p>
              <p><strong>Applicant:</strong> ${escapeHtml(app.studentName)}</p>
              <p><strong>Email:</strong> ${escapeHtml(app.studentEmail)}</p>
              ${app.message ? `<p><strong>Message:</strong> ${escapeHtml(app.message)}</p>` : ""}
              <p style="margin-top:20px;"><a href="${escapeHtml(app.resumeUrl)}" style="background:#0A5C36; color:white; padding:12px 24px; border-radius:6px; text-decoration:none; font-weight:bold;">View Resume</a></p>
            `
          )
        );
        console.log(`[onApplicationCreated] Employer email sent to ${job.employerEmail}`);
      } catch (err) { console.error(`[onApplicationCreated] Employer email failed: ${err.message}`); }
    }

    if (app.studentEmail) {
      try {
        await sendViaResend(
          app.studentEmail,
          `Your application for ${job.title} was submitted`,
          emailWrapper(
            "Application Sent!",
            null,
            `
              <p>Hi ${escapeHtml(app.studentName) || "there"},</p>
              <p>Your application for <strong>${escapeHtml(job.title)}</strong> at <strong>${escapeHtml(job.employer)}</strong> was successfully submitted.</p>
              <p>The employer will review your resume and reach out to you directly at <strong>${escapeHtml(app.studentEmail)}</strong> if they would like to move forward.</p>
              <p>Good luck!</p>
            `
          )
        );
        console.log(`[onApplicationCreated] Confirmation sent to ${app.studentEmail}`);
      } catch (err) { console.error(`[onApplicationCreated] Student confirmation failed: ${err.message}`); }
    }
  }
);

exports.weeklyDigest = onSchedule(
  { schedule: "every monday 14:00", timeZone: "America/Chicago", secrets: [RESEND_API_KEY] },
  async () => {
    console.log("[weeklyDigest] Starting");
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
    for (const city of Object.keys(cityMap)) {
      const prefixEnd = city + "\uf8ff";
      const jobsSnap = await db.collection("job_listings")
        .where("city", ">=", city).where("city", "<=", prefixEnd)
        .where("active", "==", true).get();
      const newJobs = jobsSnap.docs.filter(d => (d.data().postedAt || "") >= oneWeekAgo);
      if (newJobs.length === 0) continue;
      const jobLines = newJobs.map(d => {
        const j = d.data();
        return `<li style="margin-bottom:8px;"><strong>${escapeHtml(j.title)}</strong> at ${escapeHtml(j.employer)} &mdash; ${escapeHtml(j.schedule) || ""}${j.pay ? " &middot; " + escapeHtml(j.pay) : ""}</li>`;
      }).join("");
      const html = emailWrapper(
        "PreDentTX Weekly",
        `New dental jobs in ${city.charAt(0).toUpperCase() + city.slice(1)} this week`,
        `<ul style="padding-left:20px;">${jobLines}</ul>
         <div style="text-align:center; margin-top:24px;"><a href="https://predenttx.com" style="background:#0A5C36; color:white; padding:12px 28px; border-radius:6px; text-decoration:none; font-weight:bold;">View All Jobs</a></div>`
      );
      for (const r of cityMap[city]) {
        try { await sendViaResend(r.email, `PreDentTX Weekly — New jobs in ${city.charAt(0).toUpperCase() + city.slice(1)}`, html); }
        catch (err) { console.error(`[weeklyDigest] Failed for ${r.email}: ${err.message}`); }
      }
    }
    console.log("[weeklyDigest] Done");
  }
);
