import { initializeApp } from "firebase/app";
import { GoogleAuthProvider, getAuth, signInWithPopup, signOut as fbSignOut } from "firebase/auth";
import { BRAND } from "@shared/brand";

// Public web config (safe to ship; access is enforced server-side by verifying ID tokens).
export const firebaseApp = initializeApp({
  apiKey: "AIzaSyAqEQeOtD6kygCOCWM8X_IwcjQ9OU7q6d4",
  authDomain: "my-career-ai.firebaseapp.com",
  projectId: "my-career-ai",
  storageBucket: "my-career-ai.firebasestorage.app",
  messagingSenderId: "853777435340",
  appId: "1:853777435340:web:c91db10bbe7dd5ddf6d069",
  measurementId: BRAND.gaMeasurementId,
});

export const auth = getAuth(firebaseApp);
export const signInWithGoogle = () => signInWithPopup(auth, new GoogleAuthProvider());
export const signOutUser = () => fbSignOut(auth);
