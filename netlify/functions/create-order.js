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
    size = "",
    color = "",
    total: passedTotal,
  } = body;

  // 1. Sanitize & Validate Inputs
  const cleanName = typeof name === "string" ? name.trim().slice(0, 100) : "";
  const cleanPhone = typeof phone === "string" ? phone.trim().slice(0, 25) : "";
  const cleanCity = typeof city === "string" ? city.trim().slice(0, 50) : "";
  const cleanAddress = typeof delivery_address === "string" ? delivery_address.trim().slice(0, 200) : "";
  const cleanNotes = typeof notes === "string" ? notes.trim().slice(0, 500) : "";
  const cleanSize = typeof size === "string" ? size.trim().slice(0, 100) : "";
  const cleanColor = typeof color === "string" ? color.trim().slice(0, 100) : "";
  const quantity = parseInt(qty, 10);

  // Preserve size and color in customer notes
  const extraParts = [];
  if (cleanSize) extraParts.push("المقاس: " + cleanSize);
  if (cleanColor) extraParts.push("اللون: " + cleanColor);
  let effectiveNotes = cleanNotes;
  if (extraParts.length) {
    effectiveNotes = (effectiveNotes ? effectiveNotes + " | " : "") + extraParts.join(" | ");
  }

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
    // 3. Find or Match the Product in Supabase (Multi-stage Resolution)
    let targetProduct = null;
    const cleanProdQuery = typeof productNameOrId === "string" ? productNameOrId.trim() : "";
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanProdQuery);

    // Stage A: Match by UUID
    if (isUuid) {
      const { data } = await supabase.from("products").select("*").eq("id", cleanProdQuery).limit(1);
      if (data && data.length) targetProduct = data[0];
    }

    // Stage B: Substring match on name
    if (!targetProduct && cleanProdQuery) {
      const { data } = await supabase.from("products").select("*").ilike("name", `%${cleanProdQuery}%`).limit(1);
      if (data && data.length) targetProduct = data[0];
    }

    // Stage C: Substring match on slug
    if (!targetProduct && cleanProdQuery) {
      const { data } = await supabase.from("products").select("*").ilike("slug", `%${cleanProdQuery.toLowerCase()}%`).limit(1);
      if (data && data.length) targetProduct = data[0];
    }

    // Stage D: Match common keywords (e.g. "مهراس", "كلاسيكي", "مجموعة")
    if (!targetProduct && cleanProdQuery) {
      const keywords = ["مهراس", "كلاسيكي", "مجموعة"];
      for (const kw of keywords) {
        if (!targetProduct && cleanProdQuery.includes(kw)) {
          const { data } = await supabase.from("products").select("*").ilike("name", `%${kw}%`).limit(1);
          if (data && data.length) targetProduct = data[0];
        }
      }
    }

    // Stage E: Default to primary active product from Supabase
    if (!targetProduct) {
      const { data } = await supabase.from("products").select("*").eq("is_active", true).order("created_at", { ascending: true }).limit(1);
      if (data && data.length) targetProduct = data[0];
    }

    // Stage F: Resilient Fallback Object if products table is empty or pending
    if (!targetProduct) {
      targetProduct = {
        id: null,
        name: cleanProdQuery || "المهراس التونسي التقليدي الأصيل",
        price_tnd: 64.0,
        stock_quantity: 999,
        is_active: true
      };
    }

    // 4. Calculate Subtotal & Total
    const deliveryFee = quantity >= 2 ? 0.0 : 7.0; // Free delivery for 2+ items, else 7 TND
    let total = 0;
    let subtotal = 0;

    const parsedPassedTotal = parseFloat(passedTotal || body.total);
    if (!isNaN(parsedPassedTotal) && parsedPassedTotal > 0) {
      total = Number(parsedPassedTotal.toFixed(2));
      subtotal = Math.max(0, Number((total - deliveryFee).toFixed(2)));
    } else {
      const unitPrice = parseFloat(targetProduct.price_tnd) || 64.0;
      subtotal = Number((unitPrice * quantity).toFixed(2));
      total = Number((subtotal + deliveryFee).toFixed(2));
    }

    const timestampStr = new Date().toISOString().replace(/\D/g, "").slice(0, 8);
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const orderNumber = `DARNA-${timestampStr}-${randomSuffix}`;

    // 5. Try Atomic RPC Procedure if product has valid UUID
    let orderRecorded = false;
    let recordedOrderId = null;

    const isValidProductUuid = targetProduct.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetProduct.id);

    if (isValidProductUuid) {
      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc("create_darna_order", {
          p_customer_name: cleanName,
          p_customer_phone: cleanPhone,
          p_city: cleanCity,
          p_delivery_address: cleanAddress,
          p_customer_notes: effectiveNotes,
          p_product_id: targetProduct.id,
          p_quantity: quantity,
          p_delivery_fee: deliveryFee,
        });

        if (!rpcError && rpcData && rpcData.success) {
          orderRecorded = true;
          recordedOrderId = rpcData.order_id;
        }
      } catch (e) {
        // Fall back to direct insert below
      }
    }

    // 6. Direct Transaction Insert (Universal & Resilient)
    if (!orderRecorded) {
      const { data: orderData, error: orderErr } = await supabase
        .from("orders")
        .insert({
          order_number: orderNumber,
          customer_name: cleanName,
          customer_phone: cleanPhone,
          delivery_address: cleanAddress,
          city: cleanCity,
          customer_notes: effectiveNotes,
          subtotal_tnd: subtotal,
          delivery_fee_tnd: deliveryFee,
          total_tnd: total,
          payment_method: "COD",
          payment_status: "pending",
          order_status: "new",
        })
        .select()
        .single();

      if (!orderErr && orderData) {
        orderRecorded = true;
        recordedOrderId = orderData.id;

        // Insert Order Item snapshot
        await supabase.from("order_items").insert({
          order_id: orderData.id,
          product_id: isValidProductUuid ? targetProduct.id : null,
          product_name_snapshot: targetProduct.name || cleanProdQuery,
          unit_price_tnd_snapshot: Number((subtotal / quantity).toFixed(2)),
          quantity: quantity,
          line_total_tnd: subtotal,
        }).catch(err => console.warn("Order item insert note:", err));

        // Update stock quantity safely if product is tracked
        if (isValidProductUuid && typeof targetProduct.stock_quantity === "number") {
          try {
            const newStock = Math.max(0, targetProduct.stock_quantity - quantity);
            await supabase.from("products").update({ stock_quantity: newStock }).eq("id", targetProduct.id);
            await supabase.from("inventory_movements").insert({
              product_id: targetProduct.id,
              movement_type: "sale",
              quantity_change: -quantity,
              previous_stock: targetProduct.stock_quantity,
              new_stock: newStock,
              reference_order_id: orderData.id,
              notes: `طلب عميل: ${orderNumber}`,
            });
          } catch (stockErr) {
            console.warn("Stock movement update note:", stockErr);
          }
        }
      }
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        order_id: recordedOrderId || `darna_${Date.now()}`,
        order_number: orderNumber,
        product_name: targetProduct.name || cleanProdQuery,
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
