/**
 * deploy_hosting.js
 * Faz deploy no Firebase Hosting via REST API usando service account.
 * Não depende do Firebase CLI estar logado.
 */

const { GoogleAuth } = require('google-auth-library');
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const zlib   = require('zlib');

const SA_PATH   = path.join(__dirname, 'serviceAccountKey.json');
const sa        = JSON.parse(fs.readFileSync(SA_PATH, 'utf8'));
const SITE_ID   = 'prazocerto';
const PUBLIC_DIR = __dirname;

// Arquivos a ignorar no deploy
const IGNORE = new Set([
  'firebase.json', 'serviceAccountKey.json', 'package.json',
  'package-lock.json', 'setup_firebase.js', 'upload_to_firebase.js',
  'deploy_hosting.js', 'extract_ean_images.py', 'extract_pdf.py',
  'scan_pdf.py', '.firebaserc',
]);
const IGNORE_EXT  = new Set(['.py', '.json', '.docx', '.pdf', '.db']);
const IGNORE_DIRS = new Set(['node_modules', 'output', '.firebase', '.git']);

// ─── HELPERS ──────────────────────────────────────────────────
async function getToken() {
  const auth = new GoogleAuth({
    credentials: sa,
    scopes: ['https://www.googleapis.com/auth/firebase'],
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  return token;
}

function callApi(method, url, token, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? (Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))) : null;
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(!Buffer.isBuffer(body) && body ? { 'Content-Type': 'application/json' } : {}),
        ...(data ? { 'Content-Length': data.length } : {}),
        ...extraHeaders,
      },
    };
    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ─── COLETAR ARQUIVOS ─────────────────────────────────────────
function collectFiles(dir, baseDir = dir) {
  const files = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel  = '/' + path.relative(baseDir, full).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      Object.assign(files, collectFiles(full, baseDir));
    } else {
      if (IGNORE.has(entry.name)) continue;
      if (IGNORE_EXT.has(path.extname(entry.name))) continue;
      if (entry.name.startsWith('.')) continue;
      if (entry.name.endsWith('_barcode.jpg')) continue; // Ignora códigos de barra duplicados para economizar tempo
      files[rel] = full;
    }
  }
  return files;
}

// ─── MAIN DEPLOY ──────────────────────────────────────────────
(async () => {
  try {
    const token = await getToken();
    console.log('Token obtido!');

    // 1. Criar versão
    console.log('\n[1] Criando nova versão no Hosting...');
    const vRes = await callApi('POST',
      `https://firebasehosting.googleapis.com/v1beta1/sites/${SITE_ID}/versions`,
      token,
      { config: { headers: [{ glob: '**', headers: { 'Cache-Control': 'max-age=3600' } }] } }
    );
    if (!vRes.body.name) {
      console.error('Erro ao criar versão:', JSON.stringify(vRes.body).slice(0,300));
      process.exit(1);
    }
    const versionName = vRes.body.name;
    const versionId   = versionName.split('/').pop();
    console.log(`   Versão criada: ${versionId}`);

    // 2. Calcular hashes dos arquivos
    console.log('\n[2] Calculando hashes dos arquivos...');
    const files = collectFiles(PUBLIC_DIR);
    const fileCount = Object.keys(files).length;
    console.log(`   ${fileCount} arquivos encontrados`);

    const fileHashes = {}; // path → sha256 do gzip
    const gzipCache  = {}; // sha256 → Buffer gzipped
    for (const [webPath, localPath] of Object.entries(files)) {
      const content = fs.readFileSync(localPath);
      const gzipped = zlib.gzipSync(content);
      const hash    = crypto.createHash('sha256').update(gzipped).digest('hex');
      fileHashes[webPath] = hash;
      gzipCache[hash]     = gzipped;
    }

    // 3. Enviar mapa de arquivos
    console.log('\n[3] Enviando mapa de arquivos...');
    const popRes = await callApi('POST',
      `https://firebasehosting.googleapis.com/v1beta1/${versionName}:populateFiles`,
      token,
      { files: fileHashes }
    );
    const uploadUrl    = popRes.body.uploadUrl;
    const toUpload     = popRes.body.uploadRequiredHashes || [];
    console.log(`   ${toUpload.length} arquivos precisam ser enviados`);

    // 4. Upload dos arquivos necessários
    if (toUpload.length > 0) {
      console.log('\n[4] Fazendo upload dos arquivos...');
      let done = 0;
      for (const hash of toUpload) {
        const buf = gzipCache[hash];
        const url = `${uploadUrl}/${hash}`;
        const u = new URL(url);
        await new Promise((resolve, reject) => {
          const opts = {
            hostname: u.hostname,
            path: u.pathname,
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/octet-stream',
              'Content-Length': buf.length,
            },
          };
          const req = https.request(opts, res => {
            res.resume();
            res.on('end', resolve);
          });
          req.on('error', reject);
          req.write(buf);
          req.end();
        });
        done++;
        process.stdout.write(`\r   ${done}/${toUpload.length} arquivos enviados`);
      }
      console.log('');
    }

    // 5. Finalizar versão
    console.log('\n[5] Finalizando versão...');
    const finalRes = await callApi('PATCH',
      `https://firebasehosting.googleapis.com/v1beta1/${versionName}?updateMask=status`,
      token,
      { status: 'FINALIZED' }
    );
    console.log(`   Status: ${finalRes.body.status || JSON.stringify(finalRes.body).slice(0,100)}`);

    // Aguardar até FINALIZED
    let attempts = 0;
    while (attempts < 10) {
      const checkRes = await callApi('GET',
        `https://firebasehosting.googleapis.com/v1beta1/${versionName}`,
        token, null
      );
      if (checkRes.body.status === 'FINALIZED') {
        console.log('   Versão FINALIZED!');
        break;
      }
      console.log(`   Aguardando... status atual: ${checkRes.body.status}`);
      await new Promise(r => setTimeout(r, 2000));
      attempts++;
    }

    // 6. Publicar (release)
    console.log('\n[6] Publicando...');
    const relRes = await callApi('POST',
      `https://firebasehosting.googleapis.com/v1beta1/sites/${SITE_ID}/releases?versionName=${versionName}`,
      token,
      {}
    );
    if (relRes.status === 200) {
      console.log('=======================================================');
      console.log('DEPLOY CONCLUIDO!');
      console.log('  App: https://prazocerto.web.app');
      console.log('  App: https://prazocerto.firebaseapp.com');
      console.log('=======================================================');
    } else {
      console.log('Resposta release:', JSON.stringify(relRes.body).slice(0,300));
    }

    process.exit(0);
  } catch(e) {
    console.error('Erro:', e.message);
    process.exit(1);
  }
})();
