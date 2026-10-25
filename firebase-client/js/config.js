// Site configuration.
window.VF_CONFIG = {
  appName: 'VoiceFrame Studio',
  // Server relay for the free AI tier (/text, /image), deployed from
  // voiceframe-relay/ to Vercel. Pollinations blocks keyless calls made
  // straight from browsers, so they go through this relay.
  apiBase: 'https://voiceframe-relay.vercel.app/api',
  // Firebase project voiceframe-6f5b3 (web config is public by design).
  firebase: {
    apiKey: 'AIzaSyD9EzLGavE0inEyfLQL6UUP2R2aqe9Izms',
    authDomain: 'voiceframe-6f5b3.firebaseapp.com',
    projectId: 'voiceframe-6f5b3',
    storageBucket: 'voiceframe-6f5b3.firebasestorage.app',
    messagingSenderId: '173188419544',
    appId: '1:173188419544:web:efe026e827888a571f6cad'
  }
};
