/**
 * DARNA Mehres Store — Protected Admin API
 * Handled by: Netlify Functions
 * Routes handled under: /api/admin/*
 */

const { createClient } = require("@supabase/supabase-js");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return {
      statusCode: 503,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        message: "Supabase credentials not configured in server environment variables.",
      }),
    };
  }

  // 1. Verify Authorization Header (Supabase Auth JWT)
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      statusCode: 401,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        message: "غير مصرح. يرجى تسجيل الدخول إلى لوحة التحكم.",
      }),
    };
  }

  const token = authHeader.split(" ")[1];
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData || !userData.user) {
    return {
      statusCode: 401,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        message: "جلسة الدخول منتهية أو غير صالحة. يرجى إعادة تسجيل الدخول.",
      }),
    };
  }

  const user = userData.user;

  // 2. Verify Admin Role in admin_users table (or if configured admin email)
  const { data: adminRows, error: adminCheckErr } = await supabase
    .from("admin_users")
    .select("id, email, role")
    .eq("id", user.id)
    .limit(1);

  // If admin_users table is empty or user is first user, allow and auto-register initial admin
  let isAuthorized = false;
  if (!adminCheckErr && adminRows && adminRows.length > 0) {
    isAuthorized = true;
  } else {
    // Check total count of admin_users
    const { count } = await supabase.from("admin_users").select("*", { count: "exact", head: true });
    if (count === 0) {
      // First registered user becomes the admin!
      await supabase.from("admin_users").insert({
        id: user.id,
        email: user.email,
        role: "owner",
      });
      isAuthorized = true;
    }
  }

  if (!isAuthorized) {
    return {
      statusCode: 403,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        message: "هذا الحساب غير مخوّل بالوصول إلى لوحة تحكم دارنا.",
      }),
    };
  }

  // 3. Route Dispatcher based on path
  // Netlify path formats: /api/admin/orders, /.netlify/functions/admin-api/orders, etc.
  const path = event.path.replace(/^\/(?:api\/admin|\.netlify\/functions\/admin-api)/, "").replace(/^\/+/, "");
  const method = event.httpMethod;
  const segments = path.split("/").filter(Boolean);
  const resource = segments[0] || "overview";
  const resourceId = segments[1];

  let body = {};
  if (method === "POST" || method === "PATCH") {
    try {
      body = JSON.parse(event.body || "{}");
    } catch (e) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: false, message: "بيانات JSON غير صالحة" }),
      };
    }
  }

  try {
    // --------------------------------------------------------------------------
    // A. OVERVIEW METRICS
    // --------------------------------------------------------------------------
    if (resource === "overview" && method === "GET") {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayISO = todayStart.toISOString();

      // Parallel metric queries
      const [
        ordersTodayRes,
        ordersAwaitingRes,
        ordersDeliveredRes,
        totalSalesRes,
        salesTodayRes,
        recentOrdersRes,
        lowStockRes,
        tasksRes,
        expensesRes,
      ] = await Promise.all([
        supabase.from("orders").select("id", { count: "exact", head: true }).gte("created_at", todayISO),
        supabase.from("orders").select("id", { count: "exact", head: true }).in("order_status", ["new", "confirmed", "preparing"]),
        supabase.from("orders").select("id", { count: "exact", head: true }).eq("order_status", "delivered"),
        supabase.from("orders").select("total_tnd").neq("order_status", "cancelled"),
        supabase.from("orders").select("total_tnd").gte("created_at", todayISO).neq("order_status", "cancelled"),
        supabase.from("orders").select("*, order_items(*)").order("created_at", { ascending: false }).limit(8),
        supabase.from("products").select("id, name, stock_quantity, price_tnd").lte("stock_quantity", 5).eq("is_active", true),
        supabase.from("tasks").select("*").neq("status", "done").order("due_date", { ascending: true }).limit(5),
        supabase.from("expenses").select("amount_tnd"),
      ]);

      const totalSales = (totalSalesRes.data || []).reduce((acc, o) => acc + Number(o.total_tnd || 0), 0);
      const salesToday = (salesTodayRes.data || []).reduce((acc, o) => acc + Number(o.total_tnd || 0), 0);
      const totalExpenses = (expensesRes.data || []).reduce((acc, e) => acc + Number(e.amount_tnd || 0), 0);
      const estimatedProfit = Number((totalSales - totalExpenses).toFixed(2));

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          metrics: {
            orders_today: ordersTodayRes.count || 0,
            orders_awaiting: ordersAwaitingRes.count || 0,
            orders_delivered: ordersDeliveredRes.count || 0,
            sales_today_tnd: Number(salesToday.toFixed(2)),
            total_sales_tnd: Number(totalSales.toFixed(2)),
            total_expenses_tnd: Number(totalExpenses.toFixed(2)),
            estimated_profit_tnd: estimatedProfit,
            low_stock_count: (lowStockRes.data || []).length,
          },
          recent_orders: recentOrdersRes.data || [],
          low_stock_products: lowStockRes.data || [],
          upcoming_tasks: tasksRes.data || [],
        }),
      };
    }

    // --------------------------------------------------------------------------
    // B. ORDERS MANAGEMENT
    // --------------------------------------------------------------------------
    if (resource === "orders") {
      if (method === "GET") {
        const { status, payment_status, q, limit = "50", offset = "0" } = event.queryStringParameters || {};
        let query = supabase
          .from("orders")
          .select("*, order_items(*)", { count: "exact" })
          .order("created_at", { ascending: false })
          .range(parseInt(offset, 10), parseInt(offset, 10) + parseInt(limit, 10) - 1);

        if (status && status !== "all") {
          query = query.eq("order_status", status);
        }
        if (payment_status && payment_status !== "all") {
          query = query.eq("payment_status", payment_status);
        }
        if (q) {
          query = query.or(`order_number.ilike.%${q}%,customer_name.ilike.%${q}%,customer_phone.ilike.%${q}%,city.ilike.%${q}%`);
        }

        const { data, count, error } = await query;
        if (error) throw error;

        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({ success: true, orders: data || [], total: count || 0 }),
        };
      }

      if (method === "PATCH" && resourceId) {
        const updates = {};
        if (body.order_status) updates.order_status = body.order_status;
        if (body.payment_status) updates.payment_status = body.payment_status;
        if (body.internal_notes !== undefined) updates.internal_notes = body.internal_notes;

        const { data, error } = await supabase
          .from("orders")
          .update(updates)
          .eq("id", resourceId)
          .select("*, order_items(*)")
          .single();

        if (error) throw error;
        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({ success: true, order: data }),
        };
      }
    }

    // --------------------------------------------------------------------------
    // C. PRODUCTS & STOCK MANAGEMENT
    // --------------------------------------------------------------------------
    if (resource === "products") {
      if (method === "GET") {
        const { data, error } = await supabase
          .from("products")
          .select("*")
          .order("created_at", { ascending: true });

        if (error) throw error;
        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({ success: true, products: data || [] }),
        };
      }

      if (method === "POST") {
        const { name, slug, description, price_tnd, image_url, stock_quantity = 0, is_active = true } = body;
        if (!name || !price_tnd) {
          return {
            statusCode: 400,
            headers: CORS_HEADERS,
            body: JSON.stringify({ success: false, message: "اسم المنتج والسعر مطلوبان" }),
          };
        }

        const finalSlug = slug || name.toLowerCase().replace(/[\s\W]+/g, "-");
        const { data, error } = await supabase
          .from("products")
          .insert({
            name: name.trim(),
            slug: finalSlug,
            description: description || "",
            price_tnd: Number(price_tnd),
            image_url: image_url || "mehres_classic.jpg",
            stock_quantity: parseInt(stock_quantity, 10) || 0,
            is_active: Boolean(is_active),
          })
          .select()
          .single();

        if (error) throw error;

        // Record initial inventory movement
        await supabase.from("inventory_movements").insert({
          product_id: data.id,
          movement_type: "initial",
          quantity_change: data.stock_quantity,
          previous_stock: 0,
          new_stock: data.stock_quantity,
          notes: "إضافة منتج جديد",
        });

        return {
          statusCode: 201,
          headers: CORS_HEADERS,
          body: JSON.stringify({ success: true, product: data }),
        };
      }

      if (method === "PATCH" && resourceId) {
        const updates = {};
        if (body.name !== undefined) updates.name = body.name.trim();
        if (body.description !== undefined) updates.description = body.description;
        if (body.price_tnd !== undefined) updates.price_tnd = Number(body.price_tnd);
        if (body.image_url !== undefined) updates.image_url = body.image_url;
        if (body.is_active !== undefined) updates.is_active = Boolean(body.is_active);

        // Handle stock update & inventory movement
        if (body.stock_quantity !== undefined) {
          const newStock = parseInt(body.stock_quantity, 10);
          const { data: currentProduct } = await supabase
            .from("products")
            .select("stock_quantity")
            .eq("id", resourceId)
            .single();

          if (currentProduct && currentProduct.stock_quantity !== newStock) {
            const diff = newStock - currentProduct.stock_quantity;
            updates.stock_quantity = newStock;
            await supabase.from("inventory_movements").insert({
              product_id: resourceId,
              movement_type: diff > 0 ? "restock" : "adjustment",
              quantity_change: diff,
              previous_stock: currentProduct.stock_quantity,
              new_stock: newStock,
              notes: body.stock_note || "تعديل يدوي من لوحة التحكم",
            });
          }
        }

        const { data, error } = await supabase
          .from("products")
          .update(updates)
          .eq("id", resourceId)
          .select()
          .single();

        if (error) throw error;
        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({ success: true, product: data }),
        };
      }
    }

    // --------------------------------------------------------------------------
    // D. TASKS MANAGEMENT (Personal Tracker)
    // --------------------------------------------------------------------------
    if (resource === "tasks") {
      if (method === "GET") {
        const { data, error } = await supabase
          .from("tasks")
          .select("*")
          .order("due_date", { ascending: true, nullsFirst: false });

        if (error) throw error;
        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({ success: true, tasks: data || [] }),
        };
      }

      if (method === "POST") {
        const { title, description = "", status = "todo", priority = "medium", due_date = null } = body;
        if (!title) {
          return {
            statusCode: 400,
            headers: CORS_HEADERS,
            body: JSON.stringify({ success: false, message: "عنوان المهمة مطلوب" }),
          };
        }

        const { data, error } = await supabase
          .from("tasks")
          .insert({
            title: title.trim(),
            description: description.trim(),
            status,
            priority,
            due_date: due_date || null,
          })
          .select()
          .single();

        if (error) throw error;
        return {
          statusCode: 201,
          headers: CORS_HEADERS,
          body: JSON.stringify({ success: true, task: data }),
        };
      }

      if (method === "PATCH" && resourceId) {
        const updates = {};
        if (body.title !== undefined) updates.title = body.title.trim();
        if (body.description !== undefined) updates.description = body.description;
        if (body.status !== undefined) {
          updates.status = body.status;
          if (body.status === "done") updates.completed_at = new Date().toISOString();
        }
        if (body.priority !== undefined) updates.priority = body.priority;
        if (body.due_date !== undefined) updates.due_date = body.due_date || null;

        const { data, error } = await supabase
          .from("tasks")
          .update(updates)
          .eq("id", resourceId)
          .select()
          .single();

        if (error) throw error;
        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({ success: true, task: data }),
        };
      }

      if (method === "DELETE" && resourceId) {
        const { error } = await supabase.from("tasks").delete().eq("id", resourceId);
        if (error) throw error;
        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({ success: true }),
        };
      }
    }

    // --------------------------------------------------------------------------
    // E. EXPENSES MANAGEMENT
    // --------------------------------------------------------------------------
    if (resource === "expenses") {
      if (method === "GET") {
        const { category, date_from, date_to } = event.queryStringParameters || {};
        let query = supabase.from("expenses").select("*").order("date", { ascending: false });

        if (category && category !== "all") query = query.eq("category", category);
        if (date_from) query = query.gte("date", date_from);
        if (date_to) query = query.lte("date", date_to);

        const { data, error } = await query;
        if (error) throw error;

        const total = (data || []).reduce((acc, e) => acc + Number(e.amount_tnd || 0), 0);
        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            success: true,
            expenses: data || [],
            total_tnd: Number(total.toFixed(2)),
          }),
        };
      }

      if (method === "POST") {
        const { title, category, amount_tnd, date, notes = "" } = body;
        if (!title || !category || !amount_tnd) {
          return {
            statusCode: 400,
            headers: CORS_HEADERS,
            body: JSON.stringify({ success: false, message: "العنوان، التصنيف، والمبلغ مطلوبان" }),
          };
        }

        const { data, error } = await supabase
          .from("expenses")
          .insert({
            title: title.trim(),
            category,
            amount_tnd: Number(amount_tnd),
            date: date || new Date().toISOString().split("T")[0],
            notes: notes.trim(),
          })
          .select()
          .single();

        if (error) throw error;
        return {
          statusCode: 201,
          headers: CORS_HEADERS,
          body: JSON.stringify({ success: true, expense: data }),
        };
      }

      if (method === "DELETE" && resourceId) {
        const { error } = await supabase.from("expenses").delete().eq("id", resourceId);
        if (error) throw error;
        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({ success: true }),
        };
      }
    }

    return {
      statusCode: 404,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, message: "المسار غير موجود (Not found)" }),
    };
  } catch (err) {
    console.error("DARNA ADMIN API ERROR:", err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        message: "حدث خطأ في الخادم أثناء معالجة الطلب.",
        error: process.env.NODE_ENV === "development" ? err.message : undefined,
      }),
    };
  }
};
