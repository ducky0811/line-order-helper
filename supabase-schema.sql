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
  customer_name text not null default '',
  phone text not null default '',
  fulfillment text not null default 'pickup',
  pickup_time text not null default '',
  note text not null default '',
  items jsonb not null default '[]'::jsonb,
  summary text not null,
  total numeric not null check (total >= 0),
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists products_merchant_idx on public.products (merchant_id, active, sort_order);
create index if not exists orders_merchant_idx on public.orders (merchant_id, created_at desc);

alter table public.products enable row level security;
alter table public.orders enable row level security;
-- 後端只使用 service role key；請勿把 service role key 放進瀏覽器端。

-- 若舊測試資料庫已先建立 orders，可安全重跑以下欄位升級。
alter table public.orders add column if not exists customer_name text not null default '';
alter table public.orders add column if not exists phone text not null default '';
alter table public.orders add column if not exists fulfillment text not null default 'pickup';
alter table public.orders add column if not exists pickup_time text not null default '';
alter table public.orders add column if not exists note text not null default '';
