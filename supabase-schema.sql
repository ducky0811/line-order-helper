create table if not exists public.products (
  id uuid primary key,
  merchant_id text not null,
  name text not null,
  price numeric not null check (price >= 0),
  description text not null default '',
  image_url text not null default '',
  active boolean not null default true,
  stock integer,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key,
  merchant_id text not null,
  line_user_id text,
  claim_code text unique,
  claimed_at timestamptz,
  customer_name text not null default '',
  phone text not null default '',
  fulfillment text not null default 'pickup',
  pickup_time text not null default '',
  note text not null default '',
  payment_method text not null default 'cash',
  payment_status text not null default 'unpaid',
  transfer_last5 text not null default '',
  paid_at timestamptz,
  items jsonb not null default '[]'::jsonb,
  summary text not null,
  total numeric not null check (total >= 0),
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.store_settings (
  merchant_id text primary key,
  store_name text not null default '接單小幫手',
  tagline text not null default '想吃什麼，慢慢挑',
  description text not null default '',
  logo_url text not null default '',
  hero_image_url text not null default '',
  phone text not null default '',
  address text not null default '',
  business_hours text not null default '',
  accepting_orders boolean not null default true,
  merchant_line_user_id text not null default '',
  cash_enabled boolean not null default true,
  bank_transfer_enabled boolean not null default true,
  bank_name text not null default '',
  bank_code text not null default '',
  bank_account text not null default '',
  bank_account_name text not null default '',
  payment_instructions text not null default '',
  checkout_fields jsonb not null default '{"customer_name":{"label":"取貨人姓名","enabled":true,"required":true},"phone":{"label":"聯絡電話","enabled":true,"required":true},"pickup_time":{"label":"希望取貨時間","enabled":true,"required":false},"note":{"label":"備註","enabled":true,"required":false}}'::jsonb,
  fulfillment_options jsonb not null default '[{"id":"pickup","label":"到店取貨","enabled":true},{"id":"delivery","label":"外送","enabled":true}]'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists products_merchant_idx on public.products (merchant_id, active, sort_order);
create index if not exists orders_merchant_idx on public.orders (merchant_id, created_at desc);

alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.store_settings enable row level security;
-- 後端只使用 service role key；請勿把 service role key 放進瀏覽器端。

-- 若舊測試資料庫已先建立 orders，可安全重跑以下欄位升級。
alter table public.orders add column if not exists customer_name text not null default '';
alter table public.orders add column if not exists phone text not null default '';
alter table public.orders add column if not exists fulfillment text not null default 'pickup';
alter table public.orders add column if not exists pickup_time text not null default '';
alter table public.orders add column if not exists note text not null default '';
alter table public.orders add column if not exists claim_code text unique;
alter table public.orders add column if not exists claimed_at timestamptz;
alter table public.orders add column if not exists payment_method text not null default 'cash';
alter table public.orders add column if not exists payment_status text not null default 'unpaid';
alter table public.orders add column if not exists transfer_last5 text not null default '';
alter table public.orders add column if not exists paid_at timestamptz;
alter table public.store_settings add column if not exists merchant_line_user_id text not null default '';
alter table public.store_settings add column if not exists cash_enabled boolean not null default true;
alter table public.store_settings add column if not exists bank_transfer_enabled boolean not null default true;
alter table public.store_settings add column if not exists bank_name text not null default '';
alter table public.store_settings add column if not exists bank_code text not null default '';
alter table public.store_settings add column if not exists bank_account text not null default '';
alter table public.store_settings add column if not exists bank_account_name text not null default '';
alter table public.store_settings add column if not exists payment_instructions text not null default '';
alter table public.store_settings add column if not exists checkout_fields jsonb not null default '{"customer_name":{"label":"取貨人姓名","enabled":true,"required":true},"phone":{"label":"聯絡電話","enabled":true,"required":true},"pickup_time":{"label":"希望取貨時間","enabled":true,"required":false},"note":{"label":"備註","enabled":true,"required":false}}'::jsonb;
alter table public.store_settings add column if not exists fulfillment_options jsonb not null default '[{"id":"pickup","label":"到店取貨","enabled":true},{"id":"delivery","label":"外送","enabled":true}]'::jsonb;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
