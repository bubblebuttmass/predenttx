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
export async function notify({ to, subject, html }) {
    try {
        await sendNotificationEmail({ to, subject, html });
    } catch (err) {
        console.error("Notification failed (non-blocking):", err);
    }
}

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
