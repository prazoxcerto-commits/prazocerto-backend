-- 1. Criação dos tipos enumerados
DO $$ BEGIN
    CREATE TYPE subscription_status AS ENUM ('active', 'trialing', 'canceled', 'past_due', 'unpaid');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE payment_method_type AS ENUM ('credit_card', 'pix');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE plan_interval AS ENUM ('monthly', 'yearly');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Tabela de Assinaturas (Subscriptions)
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(128) NOT NULL, -- Compatível com Firebase UID ou UUID
    plan_id VARCHAR(50) NOT NULL DEFAULT 'pro',
    plan_interval plan_interval NOT NULL DEFAULT 'monthly',
    status subscription_status NOT NULL DEFAULT 'unpaid',
    payment_method payment_method_type NOT NULL,
    gateway_subscription_id VARCHAR(100) UNIQUE, -- ID preapproval do Mercado Pago (/v1/subscriptions)
    last_payment_id VARCHAR(100),                -- ID do último pagamento aprovado
    payer_email VARCHAR(255) NOT NULL,
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Índices de alta performance para Webhooks e Cron Jobs
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status_period ON subscriptions(status, current_period_end);
CREATE INDEX IF NOT EXISTS idx_subscriptions_gateway_id ON subscriptions(gateway_subscription_id);
