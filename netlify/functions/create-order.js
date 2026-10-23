/**
 * DARNA Mehres Store — Serverless Order Creation Function
 * Endpoint: POST /api/create-order
 * Handled by: Netlify Functions
 */

const { createClient } = require("@supabase/supabase-js");

// In-memory rate limiting map (IP -> timestamps array)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 4; // Max 4 orders per minute per IP

function isRateLimited(ip) {
  if (!ip) return false;
  const now = Date.now();
  const timestamps = rateLimitMap.get(ip) || [];
  const validTimestamps = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);

  if (validTimestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    return true;
  }

  validTimestamps.push(now);
  rateLimitMap.set(ip, validTimestamps);
  return false;
}

// Clean in-memory map periodically
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of rateLimitMap.entries()) {
    const valid = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (valid.length === 0) {
      rateLimitMap.delete(ip);
    } else {
      rateLimitMap.set(ip, valid);
    }
  }
}, 5 * 60 * 1000);
if (cleanupInterval.unref) cleanupInterval.unref();

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: CORS_HEADERS,
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        message: "طريقة الطلب غير مسموح بها (Only POST accepted)",
      }),
    };
  }

  // Rate Limiting Check
  const clientIp =
    event.headers["x-nf-client-connection-ip"] ||
    event.headers["client-ip"] ||
    event.headers["x-forwarded-for"] ||
    "unknown";

  if (isRateLimited(clientIp)) {
    return {
      statusCode: 429,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        message: "لقد أرسلت عدة طلبات في وقت وجيز، يرجى الانتظار دقيقة قبل المحاولة من جديد.",
      }),
    };
  }

  // Parse Body
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (err) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        message: "بيانات الطلب غير صالحة (Invalid JSON)",
      }),
    };
  }

  const {
    name,
    phone,
    city,
    delivery_address = "",
    product: productNameOrId,
    qty = 1,
    notes = "",
  } = body;

  // 1. Sanitize & Validate Inputs
  const cleanName = typeof name === "string" ? name.trim().slice(0, 100) : "";
  const cleanPhone = typeof phone === "string" ? phone.trim().slice(0, 25) : "";
  const cleanCity = typeof city === "string" ? city.trim().slice(0, 50) : "";
  const cleanAddress = typeof delivery_address === "string" ? delivery_address.trim().slice(0, 200) : "";
  const cleanNotes = typeof notes === "string" ? notes.trim().slice(0, 500) : "";
  const quantity = parseInt(qty, 10);

  if (!cleanName || cleanName.length < 2) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        message: "يرجى كتابة الاسم واللقب بشكل صحيح",
      }),
    };
  }

  if (!cleanPhone || !/^[\d\s\+\-]{6,25}$/.test(cleanPhone)) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        message: "يرجى إدخال رقم هاتف صالح (مثال: 27900771)",
      }),
    };
  }

  if (!cleanCity || cleanCity.length < 2) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        message: "يرجى اختيار الولاية التونسية",
      }),
    };
  }

  if (isNaN(quantity) || quantity < 1 || quantity > 20) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        message: "الكمية يجب أن تكون بين 1 و 20",
      }),
    };
  }

  if (!productNameOrId) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        message: "يرجى اختيار المنتج المراد طلبه",
      }),
    };
  }

  // 2. Initialize Supabase Client with Service Role Key (Server-side ONLY)
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error("DARNA BACKEND: Supabase environment variables are missing.");
    return {
      statusCode: 503,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        message: "النظام قيد التهيئة. يرجى ضبط مفاتيح Supabase في لوحة Netlify.",
      }),
    };
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  try {
    // 3. Find the Product in Supabase (By ID or Name)
    let productQuery = supabase
      .from("products")
      .select("*")
      .eq("is_active", true);

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productNameOrId);
    if (isUuid) {
      productQuery = productQuery.eq("id", productNameOrId);
    } else {
      productQuery = productQuery.ilike("name", `%${productNameOrId.trim()}%`);
    }

    const { data: products, error: productErr } = await productQuery.limit(1);

    if (productErr || !products || products.length === 0) {
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: false,
          message: "عذراً، المنتج المطلوب غير متوفر حالياً أو لم يتم العثور عليه",
        }),
      };
    }

    const targetProduct = products[0];

    // Check stock
    if (targetProduct.stock_quantity < quantity) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: false,
          message: `عذراً، الكمية المتوفرة في المخزون (${targetProduct.stock_quantity}) غير كافية للطلب`,
        }),
      };
    }

    // 4. Try Stored Procedure (RPC) First for Atomic Execution
    const deliveryFee = 7.0; // Standard delivery fee in Tunisia (7 TND)
    const { data: rpcData, error: rpcError } = await supabase.rpc("create_darna_order", {
      p_customer_name: cleanName,
      p_customer_phone: cleanPhone,
      p_city: cleanCity,
      p_delivery_address: cleanAddress,
      p_customer_notes: cleanNotes,
      p_product_id: targetProduct.id,
      p_quantity: quantity,
      p_delivery_fee: deliveryFee,
    });

    if (!rpcError && rpcData && rpcData.success) {
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          order_id: rpcData.order_id,
          order_number: rpcData.order_number,
          product_name: rpcData.product_name,
          quantity: rpcData.quantity,
          subtotal_tnd: rpcData.subtotal_tnd,
          delivery_fee_tnd: rpcData.delivery_fee_tnd,
          total_tnd: rpcData.total_tnd,
          customer_name: rpcData.customer_name,
          city: rpcData.city,
        }),
      };
    }

    // 5. Fallback Direct Transaction (if RPC is pending creation)
    const subtotal = Number((targetProduct.price_tnd * quantity).toFixed(2));
    const total = Number((subtotal + deliveryFee).toFixed(2));
    const timestampStr = new Date().toISOString().replace(/\D/g, "").slice(0, 8);
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const orderNumber = `DARNA-${timestampStr}-${randomSuffix}`;

    const { data: orderData, error: orderErr } = await supabase
      .from("orders")
      .insert({
        order_number: orderNumber,
        customer_name: cleanName,
        customer_phone: cleanPhone,
        delivery_address: cleanAddress,
        city: cleanCity,
        customer_notes: cleanNotes,
        subtotal_tnd: subtotal,
        delivery_fee_tnd: deliveryFee,
        total_tnd: total,
        payment_method: "COD",
        payment_status: "pending",
        order_status: "new",
      })
      .select()
      .single();

    if (orderErr) {
      console.error("DARNA: Order insert error:", orderErr);
      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: false,
          message: "تعذر حفظ الطلب في قاعدة البيانات. يرجى المحاولة بعد قليل.",
        }),
      };
    }

    // Insert Order Item snapshot
    await supabase.from("order_items").insert({
      order_id: orderData.id,
      product_id: targetProduct.id,
      product_name_snapshot: targetProduct.name,
      unit_price_tnd_snapshot: targetProduct.price_tnd,
      quantity: quantity,
      line_total_tnd: subtotal,
    });

    // Update stock quantity safely
    const newStock = Math.max(0, targetProduct.stock_quantity - quantity);
    await supabase
      .from("products")
      .update({ stock_quantity: newStock })
      .eq("id", targetProduct.id);

    // Record inventory movement
    await supabase.from("inventory_movements").insert({
      product_id: targetProduct.id,
      movement_type: "sale",
      quantity_change: -quantity,
      previous_stock: targetProduct.stock_quantity,
      new_stock: newStock,
      reference_order_id: orderData.id,
      notes: `طلب عميل: ${orderNumber}`,
    });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        order_id: orderData.id,
        order_number: orderNumber,
        product_name: targetProduct.name,
        quantity: quantity,
        subtotal_tnd: subtotal,
        delivery_fee_tnd: deliveryFee,
        total_tnd: total,
        customer_name: cleanName,
        city: cleanCity,
      }),
    };
  } catch (err) {
    console.error("DARNA SERVER ERROR:", err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        message: "حدث خطأ غير متوقع أثناء معالجة الطلب. يرجى المحاولة مرة أخرى.",
      }),
    };
  }
};
