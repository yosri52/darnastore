-- ==============================================================================
-- DARNA E-COMMERCE DATABASE SCHEMA & MIGRATIONS
-- Database: Supabase PostgreSQL
-- Store: DARNA — Premium Home Supplies (Mehres / مهاريس تونسية)
-- ==============================================================================

-- Enable UUID extension if not enabled
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 1. PRODUCTS TABLE
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    price_tnd NUMERIC(10, 2) NOT NULL CHECK (price_tnd >= 0), -- سعر البيع للزبائن
    cost_price_tnd NUMERIC(10, 2) DEFAULT 0 CHECK (cost_price_tnd >= 0), -- السعر الأصلي / سعر التكلفة (خاص بالإدارة)
    image_url TEXT,
    stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_active ON public.products (is_active);
CREATE INDEX IF NOT EXISTS idx_products_slug ON public.products (slug);

-- ==============================================================================
-- 2. ORDERS TABLE (Cash On Delivery Model)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number TEXT UNIQUE NOT NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    delivery_address TEXT,
    city TEXT NOT NULL,
    customer_notes TEXT,
    subtotal_tnd NUMERIC(10, 2) NOT NULL CHECK (subtotal_tnd >= 0),
    delivery_fee_tnd NUMERIC(10, 2) NOT NULL DEFAULT 7.00 CHECK (delivery_fee_tnd >= 0),
    total_tnd NUMERIC(10, 2) NOT NULL CHECK (total_tnd >= 0),
    payment_method TEXT NOT NULL DEFAULT 'COD',
    payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'refunded', 'failed')),
    order_status TEXT NOT NULL DEFAULT 'new' CHECK (order_status IN ('new', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled')),
    internal_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders (order_status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON public.orders (payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON public.orders (customer_phone);

-- Sequence for human-readable sequential order numbers
CREATE SEQUENCE IF NOT EXISTS public.order_number_seq START WITH 1001;

-- ==============================================================================
-- 3. ORDER ITEMS TABLE (With historical snapshot)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
    product_name_snapshot TEXT NOT NULL,
    unit_price_tnd_snapshot NUMERIC(10, 2) NOT NULL CHECK (unit_price_tnd_snapshot >= 0),
    quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 20),
    line_total_tnd NUMERIC(10, 2) NOT NULL CHECK (line_total_tnd >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON public.order_items (product_id);

-- ==============================================================================
-- 4. INVENTORY MOVEMENTS TABLE
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.inventory_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    movement_type TEXT NOT NULL CHECK (movement_type IN ('sale', 'restock', 'return', 'adjustment', 'initial')),
    quantity_change INTEGER NOT NULL,
    previous_stock INTEGER NOT NULL,
    new_stock INTEGER NOT NULL,
    reference_order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_product_id ON public.inventory_movements (product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_created_at ON public.inventory_movements (created_at DESC);

-- ==============================================================================
-- 5. PERSONAL TASKS TABLE (Personal Use Only)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'pending', 'done')),
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    due_date DATE,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks (status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON public.tasks (due_date);

-- ==============================================================================
-- 6. EXPENSES TABLE (Stock, Packaging, Delivery, Ads, Misc)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('stock', 'packaging', 'delivery', 'advertising', 'misc')),
    amount_tnd NUMERIC(10, 2) NOT NULL CHECK (amount_tnd > 0),
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expenses_date ON public.expenses (date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON public.expenses (category);

-- ==============================================================================
-- 7. ADMIN USERS TABLE (Explicit authorization for Supabase Auth accounts)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.admin_users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'owner')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==============================================================================
-- 8. AUTOMATIC UPDATED_AT TRIGGER
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_products_updated_at ON public.products;
CREATE TRIGGER set_products_updated_at
    BEFORE UPDATE ON public.products
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_orders_updated_at ON public.orders;
CREATE TRIGGER set_orders_updated_at
    BEFORE UPDATE ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_tasks_updated_at ON public.tasks;
CREATE TRIGGER set_tasks_updated_at
    BEFORE UPDATE ON public.tasks
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ==============================================================================
-- 9. ATOMIC ORDER CREATION STORED PROCEDURE (Prevents Race Conditions)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.create_darna_order(
    p_customer_name TEXT,
    p_customer_phone TEXT,
    p_city TEXT,
    p_delivery_address TEXT,
    p_customer_notes TEXT,
    p_product_id UUID,
    p_quantity INTEGER,
    p_delivery_fee NUMERIC DEFAULT 7.00
)
RETURNS JSON AS $$
DECLARE
    v_product public.products%ROWTYPE;
    v_order_id UUID;
    v_order_number TEXT;
    v_subtotal NUMERIC(10, 2);
    v_total NUMERIC(10, 2);
    v_new_stock INTEGER;
    v_seq_num BIGINT;
BEGIN
    -- Validate quantity
    IF p_quantity < 1 OR p_quantity > 20 THEN
        RAISE EXCEPTION 'الكمية يجب أن تكون بين 1 و 20';
    END IF;

    -- Lock product row to prevent simultaneous overselling race conditions
    SELECT * INTO v_product
    FROM public.products
    WHERE id = p_product_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'المنتج غير موجود';
    END IF;

    IF NOT v_product.is_active THEN
        RAISE EXCEPTION 'هذا المنتج غير متوفر حالياً';
    END IF;

    IF v_product.stock_quantity < p_quantity THEN
        RAISE EXCEPTION 'الكمية المتوفرة في المخزون (%s) لا تكفي للطلب', v_product.stock_quantity;
    END IF;

    -- Calculate financial amounts on server side
    v_subtotal := v_product.price_tnd * p_quantity;
    v_total := v_subtotal + p_delivery_fee;

    -- Generate human-friendly order number (e.g. DARNA-202610-1001)
    SELECT nextval('public.order_number_seq') INTO v_seq_num;
    v_order_number := 'DARNA-' || to_char(now(), 'YYYYMM') || '-' || lpad(v_seq_num::text, 4, '0');

    -- Insert Order
    INSERT INTO public.orders (
        order_number,
        customer_name,
        customer_phone,
        delivery_address,
        city,
        customer_notes,
        subtotal_tnd,
        delivery_fee_tnd,
        total_tnd,
        payment_method,
        payment_status,
        order_status
    ) VALUES (
        v_order_number,
        TRIM(p_customer_name),
        TRIM(p_customer_phone),
        TRIM(p_delivery_address),
        TRIM(p_city),
        TRIM(p_customer_notes),
        v_subtotal,
        p_delivery_fee,
        v_total,
        'COD',
        'pending',
        'new'
    ) RETURNING id INTO v_order_id;

    -- Insert Order Item with price & product snapshot
    INSERT INTO public.order_items (
        order_id,
        product_id,
        product_name_snapshot,
        unit_price_tnd_snapshot,
        quantity,
        line_total_tnd
    ) VALUES (
        v_order_id,
        v_product.id,
        v_product.name,
        v_product.price_tnd,
        p_quantity,
        v_subtotal
    );

    -- Deduct stock and log inventory movement
    v_new_stock := v_product.stock_quantity - p_quantity;

    UPDATE public.products
    SET stock_quantity = v_new_stock
    WHERE id = v_product.id;

    INSERT INTO public.inventory_movements (
        product_id,
        movement_type,
        quantity_change,
        previous_stock,
        new_stock,
        reference_order_id,
        notes
    ) VALUES (
        v_product.id,
        'sale',
        -p_quantity,
        v_product.stock_quantity,
        v_new_stock,
        v_order_id,
        'طلب جديد: ' || v_order_number
    );

    -- Return full result
    RETURN json_build_object(
        'success', true,
        'order_id', v_order_id,
        'order_number', v_order_number,
        'product_name', v_product.name,
        'quantity', p_quantity,
        'subtotal_tnd', v_subtotal,
        'delivery_fee_tnd', p_delivery_fee,
        'total_tnd', v_total,
        'customer_name', p_customer_name,
        'city', p_city
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==============================================================================
-- 10. ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================

-- Enable RLS on all tables
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- Helper function to check if current user is an authorized admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.admin_users
        WHERE id = auth.uid()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------------------------
-- Products Policies
-- ------------------------------------------------------------------------------
-- Public can view active products
DROP POLICY IF EXISTS "Public can view active products" ON public.products;
CREATE POLICY "Public can view active products"
    ON public.products
    FOR SELECT
    USING (is_active = true);

-- Admins can view all products, add, edit, and delete
DROP POLICY IF EXISTS "Admins have full access to products" ON public.products;
CREATE POLICY "Admins have full access to products"
    ON public.products
    FOR ALL
    USING (public.is_admin());

-- ------------------------------------------------------------------------------
-- Orders & Order Items Policies (Public CANNOT read customer data!)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can view orders" ON public.orders;
CREATE POLICY "Admins can view orders"
    ON public.orders
    FOR SELECT
    USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can update orders" ON public.orders;
CREATE POLICY "Admins can update orders"
    ON public.orders
    FOR UPDATE
    USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can view order items" ON public.order_items;
CREATE POLICY "Admins can view order items"
    ON public.order_items
    FOR SELECT
    USING (public.is_admin());

-- ------------------------------------------------------------------------------
-- Inventory Movements Policies
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can view inventory movements" ON public.inventory_movements;
CREATE POLICY "Admins can view inventory movements"
    ON public.inventory_movements
    FOR SELECT
    USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can insert inventory movements" ON public.inventory_movements;
CREATE POLICY "Admins can insert inventory movements"
    ON public.inventory_movements
    FOR INSERT
    WITH CHECK (public.is_admin());

-- ------------------------------------------------------------------------------
-- Tasks Policies (Personal Tracker)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins have full access to tasks" ON public.tasks;
CREATE POLICY "Admins have full access to tasks"
    ON public.tasks
    FOR ALL
    USING (public.is_admin());

-- ------------------------------------------------------------------------------
-- Expenses Policies
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins have full access to expenses" ON public.expenses;
CREATE POLICY "Admins have full access to expenses"
    ON public.expenses
    FOR ALL
    USING (public.is_admin());

-- ------------------------------------------------------------------------------
-- Admin Users Policies
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can view own admin row" ON public.admin_users;
CREATE POLICY "Admins can view own admin row"
    ON public.admin_users
    FOR SELECT
    USING (auth.uid() = id);

-- ==============================================================================
-- 11. INITIAL SEED DATA (Existing 3 DARNA Products)
-- NOTE: Prices and stock counts are placeholders and must be verified by the owner.
-- ==============================================================================
INSERT INTO public.products (id, name, slug, description, price_tnd, image_url, stock_quantity, is_active)
VALUES
    (
        '11111111-1111-1111-1111-111111111111',
        'المهراس الكلاسيكي',
        'classic-mehres',
        'المهراس الكلاسيكي التونسي النحاسي، للاستعمال اليومي وتحضير التوابل بريحة زمان.',
        45.00,
        'mehres_classic.jpg',
        25,
        true
    ),
    (
        '22222222-2222-2222-2222-222222222222',
        'مهراس دارنا المميّز',
        'darna-signature',
        'مهراس دارنا الفاخر بنقوش تراثية أصيلة، لمسة تقليدية تليق بكوجينتك وبأرقى المناسبات.',
        68.00,
        'mehres_signature.jpg',
        15,
        true
    ),
    (
        '33333333-3333-3333-3333-333333333333',
        'مجموعة المهراس',
        'the-mehres-set',
        'مجموعة المهراس المتكاملة مع المدق والتوابل، الخيار الأفضل للإهداء أو لتجهيز دار جديدة.',
        95.00,
        'mehres_set.jpg',
        10,
        true
    )
ON CONFLICT (slug) DO UPDATE
SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    image_url = EXCLUDED.image_url;
