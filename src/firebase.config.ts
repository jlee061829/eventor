import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDnFC2Fz7itMxSxzA5oTo51lZQrvAu3eVI",
  authDomain: "events-b63ff.firebaseapp.com",
  projectId: "events-b63ff",
  storageBucket: "events-b63ff.firebasestorage.app",
  messagingSenderId: "444695919125",
  appId: "1:444695919125:web:0a72053fc8fce8a4042c1c",
  measurementId: "G-L3VHKMVG5L",
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db };
