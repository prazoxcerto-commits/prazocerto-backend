const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const admin = require('firebase-admin');
const fs = require('fs');

const app = express();

// Inicializar Firebase Admin
let firestore = null;
try {
    const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
    if (fs.existsSync(serviceAccountPath)) {
        const serviceAccount = require(serviceAccountPath);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        firestore = admin.firestore();
        console.log('Firebase Admin inicializado com sucesso.');
    } else {
        console.warn('AVISO: serviceAccountKey.json não encontrado. O Firebase Firestore não funcionará.');
    }
} catch (error) {
    console.error('Erro ao inicializar Firebase Admin:', error);
}
// ── Credenciais da API GTIN OSCBR ──────────────────
// Configure via env vars no Render: OSCBR_USER e OSCBR_PASS
const OSCBR_USER = process.env.OSCBR_USER || '';
const OSCBR_PASS = process.env.OSCBR_PASS || '';

let _oscbrToken = null;
let _oscbrTokenExpires = 0;

async function getOscbrToken() {
    if (_oscbrToken && Date.now() < _oscbrTokenExpires) return _oscbrToken;
    const creds = Buffer.from(`${OSCBR_USER}:${OSCBR_PASS}`).toString('base64');
    const res = await fetch('https://gtin.rscsistemas.com.br/api/v3/oauth/token', {
        method: 'POST',
        headers: { 'Authorization': `Basic ${creds}`, 'Accept': 'application/json' }
    });
    if (!res.ok) throw new Error(`OSCBR auth falhou: ${res.status}`);
    const data = await res.json();
    _oscbrToken = data.token;
    _oscbrTokenExpires = Date.now() + 55 * 60 * 1000;
    return _oscbrToken;
}


app.use(cors());
app.use(express.json());
// Servir os arquivos HTML/CSS/JS principais
app.use(express.static(__dirname));
// Servir imagens estaticamente
app.use('/imagens', express.static(path.join(__dirname, 'imagens')));

// Conectar ao banco de dados SQLite
const db = new sqlite3.Database(path.join(__dirname, 'catalogo.db'), (err) => {
    if (err) {
        console.error('Erro ao conectar ao banco de dados:', err.message);
    } else {
        console.log('Conectado ao banco de dados SQLite (catalogo.db).');
        // Garantir que a tabela existe, caso inicie o servidor antes de extrair
        db.run(`CREATE TABLE IF NOT EXISTS produtos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ean TEXT UNIQUE,
            nome TEXT,
            foto TEXT
        )`);
        
        // Criar a tabela de cache para evitar múltiplas chamadas ao Firebase
        db.run(`CREATE TABLE IF NOT EXISTS produtos_cache (
            codigo_barras TEXT PRIMARY KEY,
            nome TEXT,
            url_imagem TEXT
        )`);
    }
});

// Buscar produto pelo EAN (Cascata: Cache SQLite -> Firebase -> APIs Externas)
app.get('/api/produtos/:ean', async (req, res) => {
    const ean = req.params.ean;
    
    // Passo 1: Buscar no SQLite do servidor (produtos_cache)
    db.get("SELECT * FROM produtos_cache WHERE codigo_barras = ?", [ean], async (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        
        if (row) {
            console.log(`[Cache Local SQLite] Encontrado EAN: ${ean}`);
            return res.json({ ean: row.codigo_barras, nome: row.nome, foto: row.url_imagem, source: 'sqlite' });
        }
        
        // Passo 2: Buscar na coleção 'produtos_catalogo' no Firebase
        try {
            if (firestore) {
                const docRef = firestore.collection('produtos_catalogo').doc(ean);
                const docSnap = await docRef.get();
                
                if (docSnap.exists) {
                    console.log(`[Firebase Firestore] Encontrado EAN: ${ean}`);
                    const data = docSnap.data();
                    
                    // Salva no SQLite local
                    db.run("INSERT OR REPLACE INTO produtos_cache (codigo_barras, nome, url_imagem) VALUES (?, ?, ?)", 
                           [ean, data.nome, data.url_imagem]);
                    
                    return res.json({ ean, nome: data.nome, foto: data.url_imagem, source: 'firebase' });
                }
            }
            
            // Passo 3: Buscar API Externa Open Food Facts
            console.log(`[API Externa Open Food Facts] Buscando EAN: ${ean}`);
            let apiResponse = await fetch(`https://world.openfoodfacts.org/api/v0/product/${ean}.json`);
            let apiData = await apiResponse.json();
            
            let nome = null;
            let url_imagem = null;
            
            if (apiData && apiData.status === 1 && apiData.product) {
                nome = apiData.product.product_name;
                url_imagem = apiData.product.image_url;
            }
            
            // Passo 4: Fallback GTIN OSCBR v3
            if (!nome || !url_imagem) {
                console.log(`[API GTIN OSCBR v3] Buscando EAN: ${ean}`);
                try {
                    const token = await getOscbrToken();
                    const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };

                    // Busca info do produto
                    const infoRes = await fetch(`https://gtin.rscsistemas.com.br/api/v3/gtin/${ean}`, { headers });
                    if (infoRes.ok) {
                        const infoData = await infoRes.json();
                        if (!nome) nome = infoData.nome || infoData.descricao || null;
                        // link_foto vem direto no response da info
                        if (!url_imagem && infoData.link_foto) url_imagem = infoData.link_foto;
                    }

                    // Se ainda não tem imagem, usa o endpoint de imagem (retorna PNG binário)
                    if (!url_imagem) {
                        url_imagem = `https://gtin.rscsistemas.com.br/api/v3/gtin/${ean}/image`;
                    }
                } catch (oscbrErr) {
                    console.warn('[API GTIN OSCBR v3] Erro:', oscbrErr.message);
                }
            }
            
            // Passo 5: Salvar nas tabelas para não gastar chamadas no futuro
            if (nome || url_imagem) {
                if (firestore) {
                    await firestore.collection('produtos_catalogo').doc(ean).set({
                        nome: nome || "Sem Nome",
                        url_imagem: url_imagem || "",
                        criadoEm: admin.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                }
                
                db.run("INSERT OR REPLACE INTO produtos_cache (codigo_barras, nome, url_imagem) VALUES (?, ?, ?)", 
                       [ean, nome || "Sem Nome", url_imagem || ""]);
                       
                return res.json({ ean, nome, foto: url_imagem, source: 'api' });
            }
            
            return res.status(404).json({ error: "Produto não encontrado em nenhuma fonte." });
            
        } catch (error) {
            console.error("Erro na busca em cascata:", error);
            res.status(500).json({ error: "Erro interno do servidor durante a busca." });
        }
    });
});

// Listar todos os produtos
app.get('/api/produtos', (req, res) => {
    const search = req.query.search || '';
    let query = "SELECT * FROM produtos";
    let params = [];
    if (search) {
        query += " WHERE nome LIKE ? OR ean LIKE ?";
        params.push(`%${search}%`, `%${search}%`);
    }
    db.all(query, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

// Adicionar novo produto
app.post('/api/produtos', (req, res) => {
    const { ean, nome, foto } = req.body;
    db.run("INSERT INTO produtos (ean, nome, foto) VALUES (?, ?, ?)", [ean, nome, foto], function(err) {
        if (err) {
            return res.status(400).json({ error: err.message });
        }
        res.json({ id: this.lastID, ean, nome, foto });
    });
});

// Atualizar produto
app.put('/api/produtos/:id', (req, res) => {
    const { ean, nome, foto } = req.body;
    db.run("UPDATE produtos SET ean = ?, nome = ?, foto = ? WHERE id = ?", [ean, nome, foto, req.params.id], function(err) {
        if (err) {
            return res.status(400).json({ error: err.message });
        }
        res.json({ message: "Atualizado com sucesso", changes: this.changes });
    });
});

// Excluir produto
app.delete('/api/produtos/:id', (req, res) => {
    db.run("DELETE FROM produtos WHERE id = ?", req.params.id, function(err) {
        if (err) {
            return res.status(400).json({ error: err.message });
        }
        res.json({ message: "Excluído com sucesso", changes: this.changes });
    });
});

app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});
