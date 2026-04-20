-- 为 transactions 表添加全文搜索支持
-- 这个迁移会：
-- 1. 添加一个 tsvector 列 search_vector
-- 2. 创建 GIN 索引以加速全文搜索
-- 3. 创建触发器函数以自动更新 search_vector
-- 4. 为现有数据填充初始值

BEGIN;

-- 1. 添加 tsvector 列
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- 2. 创建 GIN 索引
CREATE INDEX IF NOT EXISTS idx_transactions_search_vector 
ON transactions USING GIN (search_vector);

-- 3. 创建触发器函数
CREATE OR REPLACE FUNCTION transactions_search_vector_update()
RETURNS TRIGGER AS $$
BEGIN
    -- 组合多个文本字段到 search_vector
    -- 使用 'simple' 配置，避免分词器语言问题（中文内容也能按字匹配）
    -- 字段包括：content, details, finance_category, brand_snapshot, item_name_snapshot, type
    NEW.search_vector := 
        setweight(to_tsvector('simple', COALESCE(NEW.content, '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(NEW.details, '')), 'B') ||
        setweight(to_tsvector('simple', COALESCE(NEW.finance_category, '')), 'C') ||
        setweight(to_tsvector('simple', COALESCE(NEW.brand_snapshot, '')), 'C') ||
        setweight(to_tsvector('simple', COALESCE(NEW.item_name_snapshot, '')), 'C') ||
        setweight(to_tsvector('simple', COALESCE(NEW.type, '')), 'D');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. 创建触发器（如果不存在）
DROP TRIGGER IF EXISTS trig_transactions_search_vector_update ON transactions;
CREATE TRIGGER trig_transactions_search_vector_update
    BEFORE INSERT OR UPDATE ON transactions
    FOR EACH ROW
    EXECUTE FUNCTION transactions_search_vector_update();

-- 5. 为现有数据填充初始值
-- 注意：对于大量数据，这可能需要一些时间
UPDATE transactions 
SET search_vector = 
    setweight(to_tsvector('simple', COALESCE(content, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(details, '')), 'B') ||
    setweight(to_tsvector('simple', COALESCE(finance_category, '')), 'C') ||
    setweight(to_tsvector('simple', COALESCE(brand_snapshot, '')), 'C') ||
    setweight(to_tsvector('simple', COALESCE(item_name_snapshot, '')), 'C') ||
    setweight(to_tsvector('simple', COALESCE(type, '')), 'D')
WHERE search_vector IS NULL;

COMMIT;