CREATE TABLE IF NOT EXISTS partners (
  partner_id TEXT PRIMARY KEY,
  partner_name TEXT NOT NULL
);
INSERT INTO partners (partner_id, partner_name) VALUES
  ('PART01','Café Central'),('PART02','Gasolinera Express'),
  ('PART03','Tienda Moda'),('PART04','Restaurante Sabores')
ON CONFLICT (partner_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS members (
  member_id TEXT PRIMARY KEY,
  member_name TEXT NOT NULL
);
INSERT INTO members (member_id, member_name) VALUES
  ('MEM001','Ana García'),('MEM002','Carlos López'),('MEM003','María Torres'),
  ('MEM004','Pedro Ruiz'),('MEM005','Laura Díaz')
ON CONFLICT (member_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS transactions (
  transaction_id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  partner_id TEXT NOT NULL,
  points_earned INTEGER NOT NULL,
  points_redeemed INTEGER NOT NULL,
  transaction_date DATE NOT NULL,
  partner_name TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL,
  batch_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_txn_partner_date ON transactions (partner_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_txn_member_date ON transactions (member_id, transaction_date);

CREATE TABLE IF NOT EXISTS transactions_flagged (
  id BIGSERIAL PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  partner_id TEXT NOT NULL,
  points_earned INTEGER NOT NULL,
  points_redeemed INTEGER NOT NULL,
  transaction_date DATE NOT NULL,
  partner_name TEXT NOT NULL,
  flag_reason TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL
);
