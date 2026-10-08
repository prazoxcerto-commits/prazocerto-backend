import cron from 'node-cron';

export interface SubscriptionCronAdapter {
    findExpiringPixSubscriptions(daysBefore: number): Promise<Array<{ id: string; userId: string; payerEmail: string }>>;
    blockExpiredSubscriptions(): Promise<number>;
    sendRenewalAlert(email: string, subscriptionId: string, daysLeft: number): Promise<void>;
}

/**
 * Inicializa o Cron Job para rodar diariamente às 03:00 da manhã
 */
export function initSubscriptionCron(adapter: SubscriptionCronAdapter) {
    cron.schedule('0 3 * * *', async () => {
        console.log('[CRON] Iniciando rotina de verificação de assinaturas...');

        try {
            // 1. Notificar Pix que vencem em 5 dias
            const in5Days = await adapter.findExpiringPixSubscriptions(5);
            for (const sub of in5Days) {
                await adapter.sendRenewalAlert(sub.payerEmail, sub.id, 5);
            }

            // 2. Notificar Pix que vencem em 2 dias
            const in2Days = await adapter.findExpiringPixSubscriptions(2);
            for (const sub of in2Days) {
                await adapter.sendRenewalAlert(sub.payerEmail, sub.id, 2);
            }

            // 3. Bloquear assinaturas vencidas (current_period_end < NOW())
            const blockedCount = await adapter.blockExpiredSubscriptions();
            if (blockedCount > 0) {
                console.log(`[CRON] ${blockedCount} assinaturas vencidas foram bloqueadas (status: unpaid).`);
            }
        } catch (error: any) {
            console.error('[CRON ERROR] Falha na execução da rotina:', error?.message || error);
        }
    });

    console.log('[CRON] Motor de cobrança e bloqueio agendado (0 3 * * *).');
}
