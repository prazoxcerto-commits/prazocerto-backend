/**
 * setup_firebase.js
 * Ativa Firestore + Storage e faz upload de imagens e dados
 * usando a service account key diretamente via Google APIs.
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { GoogleAuth } = require('google-auth-library');
const fs   = require('fs');
const path = require('path');
const https = require('https');

const SA_PATH       = path.join(__dirname, 'serviceAccountKey.json');
const PRODUTOS_JSON = path.join(__dirname, 'output', 'produtos.json');
const IMAGES_DIR    = path.join(__dirname, 'output', 'images');
const sa            = JSON.parse(fs.readFileSync(SA_PATH, 'utf8'));
const PROJECT_ID    = sa.project_id;
const BUCKET_NAME   = `${PROJECT_ID}.firebasestorage.app`;
const COLLECTION    = 'fichas_tecnicas';

console.log(`Projeto: ${PROJECT_ID}`);
console.log(`Bucket : ${BUCKET_NAME}`);

// ─── OBTER ACCESS TOKEN ──────────────────────────────────────
async function getToken() {
  const auth = new GoogleAuth({
    credentials: sa,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  return token;
}

// ─── CHAMAR GOOGLE API ───────────────────────────────────────
function callApi(method, url, token, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(data && { 'Content-Length': Buffer.byteLength(data) }),
      },
    };
    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ─── CRIAR BUCKET DE STORAGE ─────────────────────────────────
async function criarBucket(token) {
  console.log('\n[1] Criando bucket de Storage...');
  // Tenta o nome padrão do Firebase Storage
  const buckets = [
    `${PROJECT_ID}.firebasestorage.app`,
    `${PROJECT_ID}.appspot.com`,
  ];

  for (const b of buckets) {
    const res = await callApi('POST',
      `https://storage.googleapis.com/storage/v1/b?project=${PROJECT_ID}`,
      token,
      { name: b, location: 'US', storageClass: 'STANDARD',
        iamConfiguration: { uniformBucketLevelAccess: { enabled: false } } }
    );
    if (res.status === 200 || res.status === 409) {
      console.log(`   Bucket "${b}" ${res.status === 409 ? 'já existe' : 'criado'}!`);
      return b;
    }
    console.log(`   Tentativa "${b}": ${res.status} - ${JSON.stringify(res.body).slice(0,100)}`);
  }
  return null;
}

// ─── CRIAR DATABASE FIRESTORE ────────────────────────────────
async function criarFirestore(token) {
  console.log('\n[2] Criando banco Firestore...');
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases?databaseId=(default)`;
  const res = await callApi('POST', url, token, {
    type: 'FIRESTORE_NATIVE',
    locationId: 'us-east1',
  });
  if (res.status === 200 || res.status === 409) {
    console.log(`   Firestore ${res.status === 409 ? 'já existe' : 'criado'}!`);
    return true;
  }
  console.log(`   Status: ${res.status} - ${JSON.stringify(res.body).slice(0,200)}`);
  return false;
}

// ─── TORNAR BUCKET PÚBLICO ───────────────────────────────────
async function tornarBucketPublico(bucket, token) {
  const res = await callApi('PUT',
    `https://storage.googleapis.com/storage/v1/b/${bucket}/iam`,
    token,
    {
      bindings: [
        { role: 'roles/storage.objectViewer', members: ['allUsers'] }
      ]
    }
  );
  if (res.status === 200) console.log('   Bucket público configurado!');
}

// ─── UPLOAD IMAGENS ──────────────────────────────────────────
async function uploadImagens(bucketName) {
  console.log(`\n[3] Fazendo upload de imagens para Storage...`);

  initializeApp({
    credential: cert(sa),
    storageBucket: bucketName,
  });

  const bucket = getStorage().bucket();
  const produtos = JSON.parse(fs.readFileSync(PRODUTOS_JSON, 'utf8'));
  const urls = {};
  let ok = 0, fail = 0;

  for (const prod of produtos) {
    const imgPath = path.join(IMAGES_DIR, `${prod.ean}.jpg`);
    if (!fs.existsSync(imgPath)) { urls[prod.ean] = null; fail++; continue; }

    try {
      await bucket.upload(imgPath, {
        destination: `fichas_tecnicas/${prod.ean}.jpg`,
        metadata: { contentType: 'image/jpeg' },
        public: true,
      });
      urls[prod.ean] = `https://storage.googleapis.com/${bucketName}/fichas_tecnicas/${prod.ean}.jpg`;
      ok++;
      process.stdout.write(`\r   Imagens: ${ok} ok, ${fail} erros...`);
    } catch(e) {
      urls[prod.ean] = null;
      fail++;
    }
  }
  console.log(`\n   Total: ${ok} imagens enviadas, ${fail} erros`);
  return { urls, produtos };
}

// ─── SALVAR NO FIRESTORE ─────────────────────────────────────
async function salvarFirestore(produtos, imageUrls) {
  console.log(`\n[4] Salvando ${produtos.length} produtos no Firestore...`);
  const db = getFirestore();

  // Esperar um pouco para o Firestore propagar
  await new Promise(r => setTimeout(r, 3000));

  const batch = db.batch();
  for (const p of produtos) {
    const ref = db.collection(COLLECTION).doc(p.ean);
    batch.set(ref, {
      ean: p.ean, sku: p.sku, nome: p.nome,
      categoria: p.categoria, segmento: p.segmento, marca: p.marca,
      imagemUrl: imageUrls[p.ean] || null,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  console.log(`   ${produtos.length} documentos salvos na coleção "${COLLECTION}"`);
}

// ─── DEPLOY HOSTING ──────────────────────────────────────────
async function deployHosting() {
  console.log('\n[5] Fazendo deploy no Firebase Hosting...');
  const { execSync } = require('child_process');
  try {
    // Usa a service account como credencial
    process.env.GOOGLE_APPLICATION_CREDENTIALS = SA_PATH;
    const out = execSync('firebase deploy --only hosting --project controlvald', {
      cwd: __dirname,
      env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: SA_PATH },
      timeout: 120000,
    }).toString();
    const urlMatch = out.match(/Hosting URL: (https:\/\/.+)/);
    if (urlMatch) console.log(`   App no ar: ${urlMatch[1]}`);
    else console.log('   Deploy concluido!');
  } catch(e) {
    console.log('   Erro deploy:', e.message.slice(0,200));
  }
}

// ─── MAIN ────────────────────────────────────────────────────
(async () => {
  try {
    const token = await getToken();
    console.log('Token obtido!');

    const bucketName = await criarBucket(token);
    if (!bucketName) { console.error('Falha ao criar bucket'); process.exit(1); }

    await tornarBucketPublico(bucketName, token);
    await criarFirestore(token);

    // Aguarda Firestore propagar
    console.log('\n   Aguardando 5s para APIs propagarem...');
    await new Promise(r => setTimeout(r, 5000));

    const { urls, produtos } = await uploadImagens(bucketName);
    await salvarFirestore(produtos, urls);
    await deployHosting();

    console.log('\n' + '='.repeat(55));
    console.log('TUDO CONCLUIDO!');
    console.log(`  Firestore: ${COLLECTION} (${JSON.parse(fs.readFileSync(PRODUTOS_JSON,'utf8')).length} docs)`);
    console.log(`  Storage  : ${bucketName}/fichas_tecnicas/`);
    console.log(`  App      : https://controlvald.web.app`);
    console.log('='.repeat(55));
    process.exit(0);
  } catch(e) {
    console.error('\nErro:', e.message);
    console.error(e.stack?.slice(0,500));
    process.exit(1);
  }
})();
