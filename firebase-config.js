// firebase-config.js
//
// Single source of truth for Firebase setup. Every page imports from here
// instead of duplicating the config block 6 times.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-storage.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-functions.js";

const firebaseConfig = {
    apiKey: "AIzaSyBJbOnqR5OUm3NiUqTRkpKndg6wI2BJWyg",
    authDomain: "predenttx-a18a0.firebaseapp.com",
    projectId: "predenttx-a18a0",
    storageBucket: "predenttx-a18a0.firebasestorage.app",
    messagingSenderId: "858713059242",
    appId: "1:858713059242:web:c3ef0473986c727e5205d3",
    measurementId: "G-5HKM855YXP"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);

const sendNotificationEmail = httpsCallable(functions, "sendNotificationEmail");

// Fire-and-forget — a failed email should never block the booking/accept/
// decline flow it's attached to, so this never throws back to the caller.
// Takes { type, requestId } — the Cloud Function looks up the real
// recipient and builds the email content itself server-side, rather than
// trusting whatever "to"/"subject"/"html" a client might send. This is
// what stops any logged-in user from being able to call this function
// directly and send arbitrary email to arbitrary addresses.
export async function notify(payload) {
    try {
        await sendNotificationEmail(payload);
    } catch (err) {
        console.error("Notification failed (non-blocking):", err);
    }
}

// Escapes user-submitted text before it gets inserted into innerHTML.
// Every field a user typed (bios, messages, descriptions, names) must go
// through this before being interpolated into a template literal that's
// assigned to .innerHTML — otherwise a bio or job description containing
// real HTML/script tags would execute in anyone else's browser who views it.
export function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// App Check — verifies requests actually come from this website, not a
// script hitting Firebase directly with a stolen auth token. To enable:
// 1. Firebase Console -> App Check -> Apps -> register this web app with a
//    reCAPTCHA v3 provider, and copy the site key it gives you.
// 2. Uncomment the block below and paste the site key in.
// 3. Once you've confirmed real traffic is generating valid App Check
//    tokens (the App Check console shows a "verified" metric), turn on
//    enforcement for Firestore/Storage in the console, and add
//    `enforceAppCheck: true` to the sendNotificationEmail function config.
//
// import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-app-check.js";
// initializeAppCheck(app, {
//     provider: new ReCaptchaV3Provider("YOUR_RECAPTCHA_V3_SITE_KEY"),
//     isTokenAutoRefreshEnabled: true
// });

// Shared avatar/clinic/event image uploader -> Firebase Storage.
// Path convention: {uid}/{prefix}-{timestamp}.{ext} — matched by storage.rules
// so only the owner of that uid folder can ever write into it.
export async function uploadMedia(uid, prefix, file) {
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${uid}/${prefix}-${Date.now()}.${ext}`;
    const fileRef = ref(storage, path);
    await uploadBytes(fileRef, file);
    return await getDownloadURL(fileRef);
}
