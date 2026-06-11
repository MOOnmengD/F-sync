-- 辅助理财功能 — 3 张表
-- investments: 持仓配置（每只基金的参数和当前快照）
-- investment_suggestions: 每次计算建议的记录
-- investment_actions: 每次操作的流水

BEGIN;

-- ============================================================
-- 1. 持仓配置表
-- ============================================================
CREATE TABLE IF NOT EXISTS investments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,

    -- 基金基本信息
    fund_code       TEXT,                   -- 基金代码（可选，6 位数字）
    fund_name       TEXT NOT NULL,          -- 基金名称

    -- 由用户手动更新的持仓快照（养基宝数据）
    current_value_cents     BIGINT NOT NULL,          -- C：当前市值（分）
    current_profit_rate     NUMERIC(8,6) NOT NULL,    -- R：当前持有收益率（如 0.0431 = 4.31%）

    -- 策略参数（用户配置，每只基金独立）
    target_amount_cents     BIGINT NOT NULL,          -- M：目标最大持仓金额（分）。0 = 清仓
    stop_profit_line        NUMERIC(5,4),             -- 止盈线（如 0.15 = 15%）。null = 无止盈线
    trading_cycle           TEXT NOT NULL DEFAULT 'monthly',  -- 调仓周期：'weekly' | 'monthly' | 'none'
    strategy_tag            TEXT,                     -- 策略标签：现金池 / 核心权益 / 持有 / 观察 等

    -- 元数据
    is_active       BOOLEAN NOT NULL DEFAULT true,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE(user_id, fund_name)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_investments_user_id ON investments(user_id);
CREATE INDEX IF NOT EXISTS idx_investments_active ON investments(is_active) WHERE is_active = true;

-- updated_at 自动更新
CREATE OR REPLACE FUNCTION update_investments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trig_investments_updated_at ON investments;
CREATE TRIGGER trig_investments_updated_at
    BEFORE UPDATE ON investments
    FOR EACH ROW
    EXECUTE FUNCTION update_investments_updated_at();

-- RLS
ALTER TABLE investments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "investments_user_policy" ON investments;
CREATE POLICY "investments_user_policy" ON investments
    FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- 2. 调仓建议记录表
-- ============================================================
CREATE TABLE IF NOT EXISTS investment_suggestions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    investment_id   UUID NOT NULL REFERENCES investments(id) ON DELETE CASCADE,

    -- 计算时的持仓快照
    current_value_cents     BIGINT NOT NULL,          -- C
    current_profit_rate     NUMERIC(8,6) NOT NULL,    -- R
    target_amount_cents     BIGINT NOT NULL,          -- M
    stop_profit_line        NUMERIC(5,4),             -- 止盈线
    trading_cycle           TEXT NOT NULL,            -- 调仓周期

    -- 调仓建议
    suggestion_type         TEXT NOT NULL,            -- 'sell' | 'buy' | 'hold'
    suggestion_amount_cents BIGINT,                   -- 建议调仓金额（分）
    suggestion_reason       TEXT,                     -- 触发规则的人类可读理由
    triggered_rules         TEXT[],                   -- 触发了哪些规则

    -- 用户操作
    action_status   TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'confirmed' | 'overridden' | 'ignored'
    actual_amount_cents     BIGINT,                   -- 实际调仓金额（分）
    action_time     TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_investment_suggestions_user_id ON investment_suggestions(user_id);
CREATE INDEX IF NOT EXISTS idx_investment_suggestions_investment_id ON investment_suggestions(investment_id);
CREATE INDEX IF NOT EXISTS idx_investment_suggestions_created_at ON investment_suggestions(created_at DESC);

-- RLS
ALTER TABLE investment_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "investment_suggestions_user_policy" ON investment_suggestions;
CREATE POLICY "investment_suggestions_user_policy" ON investment_suggestions
    FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- 3. 操作流水表
-- ============================================================
CREATE TABLE IF NOT EXISTS investment_actions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    investment_id   UUID NOT NULL REFERENCES investments(id) ON DELETE CASCADE,
    suggestion_id   UUID REFERENCES investment_suggestions(id),

    action_type     TEXT NOT NULL,          -- 'confirm_suggestion' | 'override_suggestion' | 'manual_adjust' | 'update_cr'
    amount_cents    BIGINT,                 -- 实际调仓金额（正=买入，负=卖出），update_cr 时为 null
    c_before_cents  BIGINT,                 -- 操作前 C
    c_after_cents   BIGINT,                 -- 操作后 C

    notes           TEXT,                   -- 含触发规则作为调仓理由
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_investment_actions_user_id ON investment_actions(user_id);
CREATE INDEX IF NOT EXISTS idx_investment_actions_investment_id ON investment_actions(investment_id);
CREATE INDEX IF NOT EXISTS idx_investment_actions_created_at ON investment_actions(created_at DESC);

-- RLS
ALTER TABLE investment_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "investment_actions_user_policy" ON investment_actions;
CREATE POLICY "investment_actions_user_policy" ON investment_actions
    FOR ALL USING (auth.uid() = user_id);

COMMIT;
