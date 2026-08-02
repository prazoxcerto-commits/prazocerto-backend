/**
 * upload_to_firebase.js
 * Faz upload das imagens para Firebase Storage
 * e salva os produtos no Firestore.
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const fs   = require('fs');
const path = require('path');

// ─── CONFIG ────────────────────────────────────────────────
const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'serviceAccountKey.json');
const PRODUTOS_JSON        = path.join(__dirname, 'output', 'produtos_v2.json');
const IMAGES_DIR           = path.join(__dirname, 'imagens');
const BUCKET_NAME          = 'controlvald-app-2026.appspot.com';
const COLLECTION_NAME      = 'fichas_tecnicas';
// ───────────────────────────────────────────────────────────

if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error('❌ serviceAccountKey.json não encontrado!');
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));

initializeApp({
  credential: cert(serviceAccount),
  storageBucket: BUCKET_NAME,
});

const db     = getFirestore();
const bucket = getStorage().bucket();
const produtos = JSON.parse(fs.readFileSync(PRODUTOS_JSON, 'utf8'));

// ─── UPLOAD IMAGENS ─────────────────────────────────────────
async function uploadImagens() {
  console.log('\n📤 Fazendo upload das imagens para Firebase Storage...\n');
  const urls = {};

  for (const prod of produtos) {
    const ean      = prod.ean;
    const imgLocal = path.join(IMAGES_DIR, `${ean}.jpg`);

    if (!fs.existsSync(imgLocal)) {
      console.warn(`  ⚠  Imagem nao encontrada: ${ean}.jpg`);
      urls[ean] = null;
      continue;
    }

    const destPath = `fichas_tecnicas/${ean}.jpg`;
    try {
      await bucket.upload(imgLocal, {
        destination: destPath,
        metadata: { contentType: 'image/jpeg' },
        public: true,
      });
      const publicUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${destPath}`;
      urls[ean] = publicUrl;
      process.stdout.write(`  OK ${ean}\n`);
    } catch (err) {
      console.error(`  ERRO ${ean}: ${err.message}`);
      urls[ean] = null;
    }
  }
  return urls;
}

// ─── SALVAR NO FIRESTORE ─────────────────────────────────────
async function salvarProdutos(imageUrls) {
  console.log(`\n📝 Salvando ${produtos.length} produtos no Firestore...\n`);

  const batchSize = 400;
  let count = 0;

  for (let i = 0; i < produtos.length; i += batchSize) {
    const batch = db.batch();
    const chunk = produtos.slice(i, i + batchSize);

    for (const prod of chunk) {
      const docRef = db.collection(COLLECTION_NAME).doc(prod.ean);
      batch.set(docRef, {
        ean:       prod.ean,
        sku:       prod.sku,
        nome:      prod.nome,
        categoria: prod.categoria,
        segmento:  prod.segmento,
        marca:     prod.marca,
        imagemUrl: imageUrls[prod.ean] || null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      count++;
    }

    await batch.commit();
    console.log(`  Batch ${Math.floor(i/batchSize)+1}: ${chunk.length} produtos salvos`);
  }

  return count;
}

// ─── MAIN ────────────────────────────────────────────────────
(async () => {
  try {
    const imageUrls = await uploadImagens();
    const total     = await salvarProdutos(imageUrls);

    console.log('\n' + '='.repeat(55));
    console.log('CONCLUIDO!');
    console.log(`  Produtos no Firestore : ${total}`);
    console.log(`  Colecao               : ${COLLECTION_NAME}`);
    console.log(`  Storage               : fichas_tecnicas/`);
    console.log(`  Bucket                : ${BUCKET_NAME}`);
    console.log('='.repeat(55));
    process.exit(0);
  } catch (err) {
    console.error('\nErro fatal:', err);
    process.exit(1);
  }
})();
