import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// ⚠️ REPLACE WITH YOUR FIREBASE CONFIGURATION
const firebaseConfig = {
  apiKey: "AIzaSyDkK8a-bS64HLuJAQ5lnNAaGp9_kFumjdA",
  authDomain: "lockify-a286a.firebaseapp.com",
  projectId: "lockify-a286a",
  storageBucket: "lockify-a286a.firebasestorage.app",
  messagingSenderId: "823014703836",
  appId: "1:823014703836:web:db439a1174bcc2b04a6a19",
  measurementId: "G-4TGWPZNH3R"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);