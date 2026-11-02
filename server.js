require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const admin = require('firebase-admin');
const fs = require('fs');
const { MercadoPagoConfig, Payment, PreApproval, PaymentRefund } = require('mercadopago');

const app = express();

const PORT = process.env.PORT || 8888;

// Inicializar Mercado Pago
const mpAccessToken = process.env.MP_ACCESS_TOKEN || '';
const mpClient = new MercadoPagoConfig({ accessToken: mpAccessToken });
const paymentClient = new Payment(mpClient);
const preApprovalClient = new PreApproval(mpClient);
const refundClient = new PaymentRefund(mpClient);

// Inicializar Firebase Admin
let firestore = null;
try {
    const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
    if (fs.existsSync(serviceAccountPath)) {
        const serviceAccount = require(serviceAccountPath);
        if (admin && admin.credential) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
            firestore = admin.firestore();
            console.log('Firebase Admin inicializado com sucesso.');
        }
    } else {
        console.warn('AVISO: serviceAccountKey.json não encontrado. O Firebase Firestore não funcionará.');
    }
} catch (error) {
    console.error('Erro ao inicializar Firebase Admin:', error);
}

// ── Credenciais da API GTIN OSCBR ──────────────────
const OSCBR_USER = process.env.OSCBR_USER || 'estudante.junior';
const OSCBR_PASS = process.env.OSCBR_PASS || '58260233lL@@';

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
app.use(express.static(__dirname));
app.use('/imagens', express.static(path.join(__dirname, 'imagens')));

// Conectar ao banco de dados SQLite com fallback seguro para nuvem
let sqlite3 = null;
let db = null;
try {
    sqlite3 = require('sqlite3').verbose();
    db = new sqlite3.Database(path.join(__dirname, 'catalogo.db'), (err) => {
        if (err) {
            console.warn('Aviso ao conectar ao SQLite local:', err.message);
        } else {
            console.log('Conectado ao banco de dados SQLite (catalogo.db).');
            db.run(`CREATE TABLE IF NOT EXISTS produtos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ean TEXT UNIQUE,
                nome TEXT,
                foto TEXT
            )`);
            db.run(`CREATE TABLE IF NOT EXISTS produtos_cache (
                codigo_barras TEXT PRIMARY KEY,
                nome TEXT,
                url_imagem TEXT
            )`);
        }
    });
} catch (sqliteErr) {
    console.warn('SQLite3 nativo desabilitado na nuvem (usando Firebase Firestore/APIs):', sqliteErr.message);
    db = {
        get: (query, params, cb) => cb(null, null),
        run: () => {}
    };
}

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

            // Passo 3.5: Buscar API Produto XYZ
            if (!nome || !url_imagem) {
                try {
                    console.log(`[API Produto XYZ] Buscando EAN: ${ean}`);
                    const xyzRes = await fetch(`https://api.produto.xyz/v1/gtin/${ean}`, { signal: AbortSignal.timeout(5000) });
                    if (xyzRes.ok) {
                        const xyzData = await xyzRes.json();
                        const prod = xyzData.Product || xyzData.product || xyzData;
                        if (prod && (prod.name || prod.nome)) {
                            if (!nome) nome = prod.name || prod.nome;
                            if (!url_imagem && (prod.image_url || prod.picture || prod.foto)) {
                                url_imagem = prod.image_url || prod.picture || prod.foto;
                            }
                        }
                    }
                } catch (xyzErr) {
                    console.warn('[API Produto XYZ] Erro:', xyzErr.message);
                }
            }
            
            // Passo 4: Fallback GTIN OSCBR v3
            if (!nome || !url_imagem) {
                console.log(`[API GTIN OSCBR v3] Buscando EAN: ${ean}`);
                try {
                    const token = await getOscbrToken();
                    const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };

                    const infoRes = await fetch(`https://gtin.rscsistemas.com.br/api/v3/gtin/${ean}`, { headers });
                    if (infoRes.ok) {
                        const infoData = await infoRes.json();
                        if (!nome) nome = infoData.nome || infoData.descricao || null;
                        if (!url_imagem && infoData.link_foto) url_imagem = infoData.link_foto;
                    }

                    if (!url_imagem) {
                        url_imagem = `https://gtin.rscsistemas.com.br/api/v3/gtin/${ean}/image`;
                    }
                } catch (oscbrErr) {
                    console.warn('[API GTIN OSCBR v3] Erro:', oscbrErr.message);
                }
            }
            
            // Passo 5: Salvar nas tabelas para cache
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

// ── ROTAS DE CHECKOUT MERCADO PAGO ──────────────────

// 1. Gerar Pix Dinâmico
app.post('/api/checkout/pix', async (req, res) => {
    try {
        const { planId, planName, amount, email, firstName, cpf, userId } = req.body;

        if (!amount || amount <= 0) {
            return res.status(400).json({ error: "Valor inválido para o plano." });
        }

        const externalRef = JSON.stringify({
            userId: userId || 'anon',
            planId: planId || 'PLANO',
            email: email || '',
            createdAt: Date.now()
        });

        const payment = await paymentClient.create({
            body: {
                transaction_amount: Number(amount),
                description: `Assinatura PrazoPro - Plano ${planName || planId}`,
                payment_method_id: 'pix',
                notification_url: 'https://prazocerto-backend-cf11.onrender.com/webhooks/mercadopago',
                external_reference: externalRef,
                payer: {
                    email: email || 'cliente@prazocerto.com',
                    first_name: firstName || 'Cliente PrazoPro',
                    identification: {
                        type: 'CPF',
                        number: (cpf || '00000000000').replace(/\D/g, '')
                    }
                }
            }
        });

        const txData = payment.point_of_interaction?.transaction_data;

        res.json({
            id: payment.id,
            status: payment.status,
            qrCode: txData?.qr_code,
            qrCodeBase64: txData?.qr_code_base64,
            expiresAt: payment.date_of_expiration
        });
    } catch (error) {
        console.error("Erro ao gerar Pix no Mercado Pago:", error);
        res.status(500).json({ 
            error: error?.message || "Falha ao gerar cobrança Pix.",
            details: error?.cause || null
        });
    }
});

// 2. Consultar status do pagamento Pix
app.get('/api/checkout/status/:id', async (req, res) => {
    try {
        const payment = await paymentClient.get({ id: req.params.id });
        res.json({
            id: payment.id,
            status: payment.status,
            statusDetail: payment.status_detail
        });
    } catch (error) {
        console.error("Erro ao consultar pagamento:", error);
        res.status(500).json({ error: error?.message || "Erro ao consultar status." });
    }
});

// 3. Assinatura com Cartão de Crédito
app.post('/api/checkout/card', async (req, res) => {
    try {
        const { cardToken, email, planId, planName, amount, userId } = req.body;

        if (!cardToken || !email || !amount) {
            return res.status(400).json({ error: "Dados incompletos para processar cartão." });
        }

        const subscription = await preApprovalClient.create({
            body: {
                reason: `Assinatura PrazoPro - Plano ${planName || planId}`,
                card_token_id: cardToken,
                payer_email: email,
                notification_url: 'https://prazocerto-backend-cf11.onrender.com/webhooks/mercadopago',
                auto_recurring: {
                    frequency: 1,
                    frequency_type: 'months',
                    transaction_amount: Number(amount),
                    currency_id: 'BRL'
                },
                status: 'authorized',
                external_reference: JSON.stringify({ userId: userId || 'anon', planId, email })
            }
        });

        res.json({
            id: subscription.id,
            status: subscription.status,
            initPoint: subscription.init_point
        });
    } catch (error) {
        console.error("Erro ao assinar com Cartão:", error);
        res.status(500).json({ error: error?.message || "Falha ao processar assinatura no cartão." });
    }
});

// 4. Webhook Mercado Pago (Notificações Automáticas)
app.post('/webhooks/mercadopago', async (req, res) => {
    res.status(200).send({ received: true });
    const { type, data, action } = req.body;
    const entityId = data?.id || req.query['data.id'] || req.query.id;

    if (!entityId) return;

    try {
        if (type === 'subscription_preapproval' || action === 'subscription_preapproval') {
            const sub = await preApprovalClient.get({ id: String(entityId) });
            console.log(`[Webhook MP] Assinatura Cartão ${entityId} status: ${sub.status}`);
            if (sub.status === 'authorized' && firestore) {
                try {
                    const extRef = JSON.parse(sub.external_reference || '{}');
                    const planId = extRef.planId || 'BRONZE';
                    const payerEmail = sub.payer_email || extRef.email || '';
                    const accessDate = new Date();
                    accessDate.setDate(accessDate.getDate() + 30);

                    if (extRef.userId && extRef.userId !== 'anon') {
                        await firestore.collection('user_data').doc(extRef.userId).set({
                            planoId: planId,
                            planoNome: planId,
                            planoAtualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
                            subscriptionCanceled: false,
                            autoRenew: true,
                            subscriptionId: entityId,
                            accessUntil: accessDate.toISOString()
                        }, { merge: true });
                        console.log(`[Webhook MP] user_data ativado (Cartão) UID ${extRef.userId} -> ${planId}`);
                    }

                    if (payerEmail) {
                        const emailKey = payerEmail.toLowerCase().replace(/[^a-zA-Z0-9]/g, '_');
                        await firestore.collection('admin_plan_grants').doc(emailKey).set({
                            plan: planId,
                            planoId: planId,
                            email: payerEmail.toLowerCase(),
                            grantedBy: 'mercadopago_subscription_webhook',
                            grantedAt: new Date().toISOString(),
                            reason: `Assinatura Cartão aprovada MP #${entityId}`,
                            expiresAt: accessDate.toISOString().split('T')[0],
                            origin: 'mercadopago_card',
                            subscriptionId: entityId
                        }, { merge: true });
                        console.log(`[Webhook MP] admin_plan_grants ativado (Cartão) para ${payerEmail} -> ${planId}`);
                    }
                } catch (e) {
                    console.warn('[Webhook MP] Erro ao processar assinatura preapproval:', e);
                }
            }
        } else if (type === 'payment' || action === 'payment.created' || action === 'payment.updated') {
            const payment = await paymentClient.get({ id: entityId });
            console.log(`[Webhook MP] Pagamento ${entityId} status: ${payment.status}`);

            if (payment.status === 'approved' && firestore) {
                try {
                    const extRef = JSON.parse(payment.external_reference || '{}');
                    const planId = extRef.planId || 'BRONZE';
                    const payerEmail = payment.payer?.email || extRef.email || '';
                    const accessDate = new Date();
                    accessDate.setDate(accessDate.getDate() + 30);

                    // 1. Grava no doc do usuário por UID (se existir)
                    if (extRef.userId && extRef.userId !== 'anon') {
                        await firestore.collection('user_data').doc(extRef.userId).set({
                            planoId: planId,
                            planoNome: planId,
                            planoAtualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
                            subscriptionCanceled: false,
                            autoRenew: true,
                            ultimoPagamentoId: entityId,
                            accessUntil: accessDate.toISOString()
                        }, { merge: true });
                        console.log(`[Webhook MP] user_data ativado para UID ${extRef.userId} -> ${planId}`);
                    }

                    // 2. Grava na collection admin_plan_grants pelo email sanitizado
                    if (payerEmail) {
                        const emailKey = payerEmail.toLowerCase().replace(/[^a-zA-Z0-9]/g, '_');
                        await firestore.collection('admin_plan_grants').doc(emailKey).set({
                            plan: planId,
                            planoId: planId,
                            email: payerEmail.toLowerCase(),
                            grantedBy: 'mercadopago_webhook',
                            grantedAt: new Date().toISOString(),
                            reason: `Pagamento Pix aprovado MP #${entityId}`,
                            expiresAt: accessDate.toISOString().split('T')[0],
                            origin: 'mercadopago_pix',
                            paymentId: entityId
                        }, { merge: true });
                        console.log(`[Webhook MP] admin_plan_grants ativado para ${payerEmail} -> ${planId}`);
                    }
                } catch (e) {
                    console.warn('[Webhook MP] Erro ao processar external_reference:', e);
                }
            }
        }
    } catch (errWebhook) {
        console.error('[Webhook MP] Erro na consulta do pagamento:', errWebhook);
    }
});

// 5. Estorno automático de pagamento e cancelamento de assinatura (Dentro dos 7 dias CDC)
app.post('/api/checkout/refund', async (req, res) => {
    try {
        const { userId, paymentId, subscriptionId } = req.body;
        console.log(`[Reembolso CDC] Solicitado para userId=${userId}, paymentId=${paymentId}, subscriptionId=${subscriptionId}`);

        let refundResult = null;
        let subCancelResult = null;

        // 1. Cancelar assinatura recorrente se houver
        if (subscriptionId) {
            try {
                subCancelResult = await preApprovalClient.update({
                    id: String(subscriptionId),
                    body: { status: 'cancelled' }
                });
                console.log(`[Reembolso CDC] Assinatura ${subscriptionId} cancelada no MP com sucesso.`);
            } catch (errSub) {
                console.warn(`[Reembolso CDC] Aviso ao cancelar assinatura ${subscriptionId}:`, errSub?.message || errSub);
            }
        }

        // 2. Se tiver paymentId, estorna o pagamento
        if (paymentId) {
            try {
                refundResult = await refundClient.create({
                    payment_id: String(paymentId)
                });
                console.log(`[Reembolso CDC] Pagamento ${paymentId} estornado com sucesso no MP.`);
            } catch (errRef) {
                console.warn(`[Reembolso CDC] Aviso ao estornar pagamento ${paymentId}:`, errRef?.message || errRef);
            }
        }

        // 3. Atualiza status no Firestore
        if (userId && firestore) {
            try {
                await firestore.collection('user_data').doc(userId).set({
                    planoId: 'GRATUITO',
                    planoNome: 'GRATUITO',
                    subscriptionCanceled: true,
                    refundProcessed: true,
                    refundAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            } catch (errFs) {
                console.warn('[Reembolso CDC] Erro ao atualizar Firestore:', errFs);
            }
        }

        res.json({
            success: true,
            message: 'Estorno e cancelamento processados com sucesso.',
            refund: refundResult,
            subscription: subCancelResult
        });
    } catch (error) {
        console.error('[Reembolso CDC Erro geral]:', error);
        res.status(500).json({ error: error?.message || 'Falha ao processar estorno automático.' });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});
