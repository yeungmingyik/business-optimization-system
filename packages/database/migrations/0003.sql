CREATE INDEX IF NOT EXISTS orders_created_page ON orders(created_at DESC,id) INCLUDE(customer_id,status,type,order_date,paid_at,total_incl_tax);
CREATE INDEX IF NOT EXISTS orders_customer_summary ON orders(customer_id,status,paid_at) INCLUDE(type,order_date,total_incl_tax);
CREATE INDEX IF NOT EXISTS customers_active_owner_ids ON customers(owner_id,id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS customers_active_owner_metrics ON customers(owner_id) INCLUDE(followup_status,next_followup_at,last_deal_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS products_active_page ON products(updated_at DESC,id) WHERE archived_at IS NULL;
