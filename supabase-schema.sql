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
