import { MercadoPagoConfig, PreApproval, Payment } from 'mercadopago';

const client = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN || ''
});

const preApprovalClient = new PreApproval(client);
const paymentClient = new Payment(client);

export interface CardSubscriptionInput {
    cardToken: string;
    payerEmail: string;
    reason: string;
    transactionAmount: number;
    frequency?: number;
    frequencyType?: 'months' | 'days';
}

export interface PixPaymentInput {
    transactionAmount: number;
    description: string;
    payerEmail: string;
    payerFirstName: string;
    payerCpf: string;
    subscriptionId: string;
}

/**
 * 1. Assinatura recorrente no Cartão de Crédito (/v1/subscriptions)
 */
export async function createCardSubscription(input: CardSubscriptionInput) {
    try {
        const response = await preApprovalClient.create({
            body: {
                reason: input.reason,
                card_token_id: input.cardToken,
                payer_email: input.payerEmail,
                auto_recurring: {
                    frequency: input.frequency || 1,
                    frequency_type: input.frequencyType || 'months',
                    transaction_amount: input.transactionAmount,
                    currency_id: 'BRL'
                },
                status: 'authorized'
            }
        });
        return response;
    } catch (error: any) {
        console.error('Erro ao criar assinatura no cartão:', error?.message || error);
        throw new Error(`Falha ao registrar assinatura no cartão: ${error?.message || 'Erro desconhecido'}`);
    }
}

/**
 * 2. Cobrança avulsa via Pix (/v1/payments)
 */
export async function createPixPayment(input: PixPaymentInput) {
    try {
        const response = await paymentClient.create({
            body: {
                transaction_amount: input.transactionAmount,
                description: input.description,
                payment_method_id: 'pix',
                external_reference: input.subscriptionId,
                payer: {
                    email: input.payerEmail,
                    first_name: input.payerFirstName,
                    identification: {
                        type: 'CPF',
                        number: input.payerCpf.replace(/\D/g, '')
                    }
                }
            }
        });

        const txData = response.point_of_interaction?.transaction_data;

        return {
            paymentId: response.id,
            qrCode: txData?.qr_code,              // Código Copia e Cola
            qrCodeBase64: txData?.qr_code_base64,  // Imagem do QR Code em Base64
            status: response.status,
            expiresAt: response.date_of_expiration
        };
    } catch (error: any) {
        console.error('Erro ao gerar cobrança Pix:', error?.message || error);
        throw new Error(`Falha ao gerar cobrança Pix: ${error?.message || 'Erro desconhecido'}`);
    }
}

export { preApprovalClient, paymentClient };
