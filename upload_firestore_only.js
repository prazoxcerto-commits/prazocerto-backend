/**
 * upload_firestore_only.js
 * Faz o upload dos 122 produtos para o Firestore.
 * As imagens agora vão ser servidas via Firebase Hosting
 * da pasta /images/
 */
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const fs   = require('fs');
const path = require('path');

const SA_PATH       = path.join(__dirname, 'serviceAccountKey.json');
const PRODUTOS_JSON = path.join(__dirname, 'output', 'produtos.json');

const sa       = JSON.parse(fs.readFileSync(SA_PATH, 'utf8'));
const produtos = JSON.parse(fs.readFileSync(PRODUTOS_JSON, 'utf8'));

initializeApp({ credential: cert(sa) });
const db = getFirestore();
const COLLECTION = 'fichas_tecnicas';

console.log(`Projeto: ${sa.project_id}`);
console.log(`Total de produtos: ${produtos.length}`);

(async () => {
  try {
    const CHUNK = 400;
    for (let i = 0; i < produtos.length; i += CHUNK) {
      const batch = db.batch();
      const slice = produtos.slice(i, i + CHUNK);
      for (const p of slice) {
        const ref = db.collection(COLLECTION).doc(p.ean);
        batch.set(ref, {
          ean: p.ean,
          sku: p.sku,
          nome: p.nome,
          categoria: p.categoria,
          segmento: p.segmento,
          marca: p.marca,
          // URL da imagem apontando para o Hosting (mesmo site)
          imagemUrl: `/images/${p.ean}.jpg`,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
      console.log(`✅ Batch ${Math.floor(i/CHUNK)+1} salvo!`);
    }
    console.log(`\n🎉 ${produtos.length} produtos salvos no Firestore com sucesso!`);
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Erro ao salvar:', err.message);
    process.exit(1);
  }
})();
