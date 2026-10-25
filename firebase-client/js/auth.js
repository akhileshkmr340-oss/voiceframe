// Login. Uses Firebase Auth when VF_CONFIG.firebase is set; otherwise falls back
// to device-only accounts (PBKDF2-hashed password in localStorage).
const FB = 'https://www.gstatic.com/firebasejs/11.10.0/';

let impl = null;
let listeners = [];
let current = null;

function emit(user) {
  current = user;
  listeners.forEach(fn => fn(user));
}

export function onUser(fn) {
  listeners.push(fn);
  if (impl) fn(current);
}
export const currentUser = () => current;
export const authMode = () => impl?.mode || 'local';

export async function initAuth() {
  const cfg = window.VF_CONFIG?.firebase;
  if (cfg && cfg.apiKey) {
    try {
      impl = await firebaseImpl(cfg);
      return impl.mode;
    } catch (e) {
      console.warn('Firebase auth unavailable, using device accounts', e);
    }
  }
  impl = localImpl();
  return impl.mode;
}

export const signIn = (email, pw) => impl.signIn(email.trim().toLowerCase(), pw);
export const signUp = (name, email, pw) => impl.signUp(name.trim(), email.trim().toLowerCase(), pw);
export const signInGoogle = () => impl.google();
export const resetPassword = email => impl.reset(email.trim().toLowerCase());
export const signOut = () => impl.signOut();

// ---------------- Firebase ----------------
async function firebaseImpl(cfg) {
  const { initializeApp } = await import(FB + 'firebase-app.js');
  const A = await import(FB + 'firebase-auth.js');
  const app = initializeApp(cfg);
  const auth = A.getAuth(app);
  await A.setPersistence(auth, A.browserLocalPersistence);
  const toUser = u => u && ({ uid: u.uid, name: u.displayName || u.email.split('@')[0], email: u.email, photo: u.photoURL });
  A.onAuthStateChanged(auth, u => emit(toUser(u)));
  const friendly = e => {
    const c = e?.code || '';
    if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found')) return 'Email or password is incorrect.';
    if (c.includes('email-already-in-use')) return 'An account with this email already exists. Sign in instead.';
    if (c.includes('weak-password')) return 'Use at least 6 characters for the password.';
    if (c.includes('popup-closed')) return 'Google sign-in was closed before finishing.';
    if (c.includes('operation-not-allowed')) return 'This sign-in method is not enabled yet.';
    if (c.includes('too-many-requests')) return 'Too many attempts. Wait a minute and try again.';
    return e?.message || 'Sign-in failed.';
  };
  const wrap = fn => async (...a) => { try { return await fn(...a); } catch (e) { throw new Error(friendly(e)); } };
  return {
    mode: 'firebase',
    signIn: wrap((email, pw) => A.signInWithEmailAndPassword(auth, email, pw)),
    signUp: wrap(async (name, email, pw) => {
      const cred = await A.createUserWithEmailAndPassword(auth, email, pw);
      if (name) { await A.updateProfile(cred.user, { displayName: name }); emit(toUser(cred.user)); }
    }),
    google: wrap(() => A.signInWithPopup(auth, new A.GoogleAuthProvider())),
    reset: wrap(email => A.sendPasswordResetEmail(auth, email)),
    signOut: () => A.signOut(auth)
  };
}

// ---------------- Device-only accounts ----------------
function localImpl() {
  const USERS = 'vf_users', SESSION = 'vf_session';
  const read = () => { try { return JSON.parse(localStorage.getItem(USERS)) || {}; } catch { return {}; } };
  const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  async function hash(pw, salt) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 150000, hash: 'SHA-256' }, key, 256);
    return hex(bits);
  }
  const userOf = (email, rec) => ({ uid: 'local-' + rec.id, name: rec.name || email.split('@')[0], email, photo: null });
  setTimeout(() => {
    const s = localStorage.getItem(SESSION);
    const rec = s && read()[s];
    emit(rec ? userOf(s, rec) : null);
  });
  return {
    mode: 'local',
    async signIn(email, pw) {
      const rec = read()[email];
      if (!rec || (await hash(pw, rec.salt)) !== rec.hash) throw new Error('Email or password is incorrect.');
      localStorage.setItem(SESSION, email);
      emit(userOf(email, rec));
    },
    async signUp(name, email, pw) {
      if (pw.length < 6) throw new Error('Use at least 6 characters for the password.');
      const users = read();
      if (users[email]) throw new Error('An account with this email already exists. Sign in instead.');
      const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
      users[email] = { id: hex(crypto.getRandomValues(new Uint8Array(8))), name, salt, hash: await hash(pw, salt) };
      localStorage.setItem(USERS, JSON.stringify(users));
      localStorage.setItem(SESSION, email);
      emit(userOf(email, users[email]));
    },
    async google() { throw new Error('Google sign-in is available on the live site. Use email and password here.'); },
    async reset() { throw new Error('Device accounts can\'t be reset by email. Create a new account instead.'); },
    async signOut() { localStorage.removeItem(SESSION); emit(null); }
  };
}
