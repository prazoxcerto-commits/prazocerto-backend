const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'serviceAccountKey.json');
const PRODUTOS_JSON = path.join(__dirname, 'output', 'produtos_v2.json');
const COLLECTION_NAME = 'fichas_tecnicas';

if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error('❌ serviceAccountKey.json não encontrado!');
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();
const produtos = JSON.parse(fs.readFileSync(PRODUTOS_JSON, 'utf8'));

async function salvarProdutos() {
  console.log(`\n📝 Salvando ${produtos.length} produtos no Firestore...\n`);

  const batchSize = 400;
  let count = 0;

  for (let i = 0; i < produtos.length; i += batchSize) {
    const batch = db.batch();
    const chunk = produtos.slice(i, i + batchSize);

    for (const prod of chunk) {
      if (!prod.ean) continue;
      const docRef = db.collection(COLLECTION_NAME).doc(prod.ean);
      batch.set(docRef, {
        ean:       prod.ean,
        nome:      prod.nome,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      count++;
    }

    await batch.commit();
    console.log(`  Batch ${Math.floor(i/batchSize)+1}: ${chunk.length} produtos salvos`);
  }

  return count;
}

(async () => {
  try {
    const total = await salvarProdutos();
    console.log('\nCONCLUIDO! Produtos subidos para o Firestore:', total);
    process.exit(0);
  } catch (err) {
    console.error('\nErro fatal:', err);
    process.exit(1);
  }
})();
