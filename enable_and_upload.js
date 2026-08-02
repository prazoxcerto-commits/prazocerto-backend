/**
 * enable_and_upload.js
 * 1. Ativa Firestore via REST API
 * 2. Salva 122 produtos no Firestore
 * 3. Tenta upload de imagens no Storage
 */
const { GoogleAuth } = require('google-auth-library');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const SA_PATH       = path.join(__dirname, 'serviceAccountKey.json');
const PRODUTOS_JSON = path.join(__dirname, 'output', 'produtos.json');
const IMAGES_DIR    = path.join(__dirname, 'output', 'images');
const sa            = JSON.parse(fs.readFileSync(SA_PATH, 'utf8'));
const PROJECT_ID    = sa.project_id;
const COLLECTION    = 'fichas_tecnicas';
const produtos      = JSON.parse(fs.readFileSync(PRODUTOS_JSON, 'utf8'));

console.log(`Projeto: ${PROJECT_ID} | ${produtos.length} produtos`);

async function getToken() {
  const auth = new GoogleAuth({
    credentials: sa,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  return (await (await auth.getClient()).getAccessToken()).token;
}

function callApi(method, url, token, body) {
  return new Promise((resolve, reject) => {
    const u    = new URL(url);
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req  = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': data.length } : {}),
      },
    }, res => {
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

// ─── ATIVAR APIS VIA SERVICE USAGE ───────────────────────────
async function enableApi(token, apiName) {
  const url = `https://serviceusage.googleapis.com/v1/projects/${PROJECT_ID}/services/${apiName}:enable`;
  const res = await callApi('POST', url, token, {});
  if (res.status === 200 || res.status === 409) {
    console.log(`  ✅ API ${apiName} ativada`);
    return true;
  }
  console.log(`  ⚠️  ${apiName}: ${res.status} - ${JSON.stringify(res.body).slice(0,100)}`);
  return false;
}

// ─── CRIAR DATABASE FIRESTORE ─────────────────────────────────
async function criarFirestore(token) {
  console.log('\n[1] Ativando Firestore API...');
  await enableApi(token, 'firestore.googleapis.com');

  console.log('[2] Criando banco de dados Firestore...');
  await new Promise(r => setTimeout(r, 5000)); // aguarda API propagar

  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases?databaseId=(default)`;
  const res = await callApi('POST', url, token, {
    type: 'FIRESTORE_NATIVE',
    locationId: 'nam5',
  });
  if (res.status === 200) { console.log('  ✅ Firestore criado!'); return true; }
  if (res.status === 409)  { console.log('  ✅ Firestore já existe!'); return true; }
  console.log(`  ⚠️  Firestore: ${res.status} - ${JSON.stringify(res.body).slice(0,200)}`);
  return false;
}

// ─── SALVAR PRODUTOS NO FIRESTORE ────────────────────────────
async function salvarProdutos(imageUrls = {}) {
  console.log(`\n[3] Salvando ${produtos.length} produtos no Firestore...`);
  await new Promise(r => setTimeout(r, 8000)); // aguarda DB propagar

  const app = initializeApp({ credential: cert(sa) });
  const db  = getFirestore(app);

  const CHUNK = 400;
  for (let i = 0; i < produtos.length; i += CHUNK) {
    const batch = db.batch();
    for (const p of produtos.slice(i, i + CHUNK)) {
      batch.set(db.collection(COLLECTION).doc(p.ean), {
        ean: p.ean, sku: p.sku, nome: p.nome,
        categoria: p.categoria, segmento: p.segmento, marca: p.marca,
        imagemUrl: imageUrls[p.ean] || null,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    console.log(`  ✅ Batch ${Math.floor(i/CHUNK)+1}: ${Math.min(CHUNK, produtos.length-i)} docs salvos`);
  }
}

// ─── CRIAR BUCKET E UPLOAD IMAGENS ───────────────────────────
async function uploadImagens(token) {
  const BUCKET = `${PROJECT_ID}.appspot.com`;
  console.log(`\n[4] Criando bucket Storage: ${BUCKET}...`);

  // Habilitar Storage API
  await enableApi(token, 'storage.googleapis.com');
  await enableApi(token, 'storage-component.googleapis.com');

  // Criar bucket
  const res = await callApi('POST',
    `https://storage.googleapis.com/storage/v1/b?project=${PROJECT_ID}`,
    token,
    { name: BUCKET, location: 'US', storageClass: 'STANDARD' }
  );
  if (res.status !== 200 && res.status !== 409) {
    console.log(`  ⚠️  Não foi possível criar bucket: ${JSON.stringify(res.body).slice(0,150)}`);
    console.log('  ℹ️  Imagens serão referenciadas localmente por enquanto.');
    return {};
  }
  console.log(`  ✅ Bucket ${res.status === 409 ? 'já existe' : 'criado'}!`);

  // Tornar bucket público
  await callApi('PUT',
    `https://storage.googleapis.com/storage/v1/b/${BUCKET}/iam`,
    token,
    { bindings: [{ role: 'roles/storage.objectViewer', members: ['allUsers'] }] }
  );

  // Upload das imagens
  const app2 = initializeApp({ credential: cert(sa), storageBucket: BUCKET }, 'storage-app');
  const bucket = getStorage(app2).bucket();
  const urls = {};
  let ok = 0;

  for (const p of produtos) {
    const img = path.join(IMAGES_DIR, `${p.ean}.jpg`);
    if (!fs.existsSync(img)) continue;
    try {
      await bucket.upload(img, {
        destination: `fichas_tecnicas/${p.ean}.jpg`,
        metadata: { contentType: 'image/jpeg' },
        public: true,
      });
      urls[p.ean] = `https://storage.googleapis.com/${BUCKET}/fichas_tecnicas/${p.ean}.jpg`;
      ok++;
      process.stdout.write(`\r  Upload: ${ok}/${produtos.length}`);
    } catch(e) { /* silencioso */ }
  }
  console.log(`\n  ✅ ${ok} imagens enviadas!`);
  return urls;
}

// ─── MAIN ────────────────────────────────────────────────────
(async () => {
  try {
    const token     = await getToken();
    await criarFirestore(token);

    let imageUrls = {};
    try {
      imageUrls = await uploadImagens(token);
    } catch(e) {
      console.log('  ⚠️  Storage indisponível, salvando sem imagens:', e.message.slice(0,100));
    }

    await salvarProdutos(imageUrls);

    console.log('\n' + '='.repeat(55));
    console.log('✅ TUDO CONCLUÍDO!');
    console.log(`  Firestore   : ${COLLECTION} (${produtos.length} produtos)`);
    console.log(`  App online  : https://${PROJECT_ID}.web.app`);
    console.log('='.repeat(55));
    process.exit(0);
  } catch(e) {
    console.error('\n❌ Erro:', e.message);
    process.exit(1);
  }
})();
