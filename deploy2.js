/**
 * deploy2.js — Deploy via firebase-tools como módulo Node.js
 * usando token gerado pela service account
 */
const { GoogleAuth } = require('google-auth-library');
const path = require('path');
const fs   = require('fs');

const SA_PATH = path.join(__dirname, 'serviceAccountKey.json');
const sa      = JSON.parse(fs.readFileSync(SA_PATH, 'utf8'));

// Encontrar firebase-tools globalmente
function findFirebaseTools() {
  const tries = [
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'firebase-tools'),
    path.join(process.env.ProgramFiles || '', 'nodejs', 'node_modules', 'firebase-tools'),
    'firebase-tools',
  ];
  for (const p of tries) {
    try { return require(p); } catch {}
  }
  return null;
}

(async () => {
  try {
    // 1. Obter token OAuth2 da service account
    console.log('Obtendo token...');
    const auth = new GoogleAuth({
      credentials: sa,
      scopes: [
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/firebase',
      ],
    });
    const client = await auth.getClient();
    const { token } = await client.getAccessToken();
    console.log('Token OK:', token.slice(0, 20) + '...');

    // 2. Tentar firebase-tools como módulo
    const firebaseTools = findFirebaseTools();
    if (firebaseTools) {
      console.log('\nUsando firebase-tools como módulo...');
      await firebaseTools.deploy({
        only: 'hosting:controlvald',
        project: 'controlvald',
        token: token,
        cwd: __dirname,
      });
      console.log('Deploy OK!');
      console.log('App: https://controlvald.web.app');
    } else {
      // 3. Fallback: usar CLI com token via variável de ambiente
      console.log('\nfirebase-tools não encontrado como módulo. Tentando CLI...');
      const { execSync } = require('child_process');
      const env = {
        ...process.env,
        GOOGLE_APPLICATION_CREDENTIALS: SA_PATH,
        FIREBASE_TOKEN: token,
      };
      const out = execSync(
        `firebase deploy --only hosting --project controlvald --token "${token}"`,
        { cwd: __dirname, env, timeout: 120000 }
      ).toString();
      console.log(out);
    }
  } catch(e) {
    console.error('Erro:', e.message);
    if (e.stack) console.error(e.stack.slice(0, 500));
    process.exit(1);
  }
})();
