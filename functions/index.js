const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

exports.checkExpirationsAndNotify = functions.pubsub.schedule("every day 08:00")
  .timeZone("America/Sao_Paulo")
  .onRun(async (context) => {
    const db = admin.firestore();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Pegar produtos
    const snapshot = await db.collection("fichas_tecnicas").get();
    const products = [];
    snapshot.forEach(doc => products.push({ id: doc.id, ...doc.data() }));

    const urgent = products.filter(p => {
      if (!p.expDate) return false;
      const exp = new Date(p.expDate + "T00:00:00");
      const diffDays = Math.round((exp - today) / 86400000);
      return diffDays >= 0 && diffDays <= 3;
    });

    if (urgent.length === 0) return null;

    // Pegar tokens FCM
    const tokensSnap = await db.collection("fcm_tokens").get();
    const tokens = [];
    tokensSnap.forEach(doc => tokens.push(doc.id));

    if (tokens.length === 0) return null;

    // Enviar notificações
    const messages = urgent.flatMap(p => {
      const exp = new Date(p.expDate + "T00:00:00");
      const diffDays = Math.round((exp - today) / 86400000);
      const timeText = diffDays === 0 ? "vence hoje" : (diffDays === 1 ? "vence amanhã" : `vence em ${diffDays} dias`);

      return tokens.map(token => ({
        token,
        notification: {
          title: `🚨 Seu ${p.name} ${timeText}!`,
          body: `Coloque na frente da geladeira ou consuma logo.`
        },
        data: {
          productId: p.id
        }
      }));
    });

    try {
      // FCM limit is 500 per batch, but for personal use this is fine
      await admin.messaging().sendAll(messages);
      console.log(`Enviadas ${messages.length} notificações.`);
    } catch (e) {
      console.error("Erro ao enviar mensagens:", e);
    }
    
    return null;
  });
