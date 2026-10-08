import { Router, Request, Response } from 'express';
import { paymentClient, preApprovalClient } from './mercadopagoService';

// Interface genérica para adaptador de banco (SQL / Firestore / SQLite)
export interface SubscriptionDatabaseAdapter {
    activateBySubscriptionId(subscriptionId: string, paymentId: string, daysToAdd: number): Promise<void>;
    activateByGatewayId(gatewaySubscriptionId: string, daysToAdd: number): Promise<void>;
    cancelByGatewayId(gatewaySubscriptionId: string): Promise<void>;
}

export function createWebhookRouter(dbAdapter: SubscriptionDatabaseAdapter): Router {
    const router = Router();

    router.post('/webhooks/mercadopago', async (req: Request, res: Response) => {
        const { type, data } = req.body;
        const entityId = data?.id;

        // Responde imediatamente com HTTP 200 para liberar o Mercado Pago
        res.status(200).send({ received: true });

        if (!entityId) return;

        try {
            // Caso 1: Pagamento avulso aprovado (Pix ou cobrança individual de fatura)
            if (type === 'payment') {
                const payment = await paymentClient.get({ id: entityId });

                if (payment.status === 'approved') {
                    const subscriptionId = payment.external_reference;
                    if (subscriptionId) {
                        const isYearly = payment.description?.toLowerCase().includes('anual') || false;
                        const days = isYearly ? 365 : 30;
                        await dbAdapter.activateBySubscriptionId(subscriptionId, entityId.toString(), days);
                    }
                }
            }

            // Caso 2: Notificação do status da assinatura de cartão (/v1/subscriptions)
            if (type === 'subscription_preapproval') {
                const sub = await preApprovalClient.get({ id: entityId });

                if (sub.status === 'authorized') {
                    await dbAdapter.activateByGatewayId(entityId.toString(), 30);
                } else if (sub.status === 'cancelled') {
                    await dbAdapter.cancelByGatewayId(entityId.toString());
                }
            }
        } catch (error: any) {
            console.error('[WEBHOOK ERROR]', error?.message || error);
        }
    });

    return router;
}
