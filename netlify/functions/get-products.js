/**
 * DARNA Mehres Store — Public Products Retrieval Function
 * Endpoint: GET /api/products
 * Handled by: Netlify Functions
 */

const { createClient } = require("@supabase/supabase-js");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "public, max-age=60, s-maxage=120", // 1 min client cache, 2 min CDN cache
};

// Fallback products matching current DARNA storefront if Supabase is pending setup
const FALLBACK_PRODUCTS = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    name: "المهراس الكلاسيكي",
    slug: "classic-mehres",
    description: "للاستعمال اليومي وتحضير التوابل.",
    price_tnd: 45.0,
    image_url: "mehres_classic.jpg",
    stock_quantity: 25,
    is_active: true,
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    name: "مهراس دارنا المميّز",
    slug: "darna-signature",
    description: "لمسة تقليدية تليق بكوجينتك.",
    price_tnd: 68.0,
    image_url: "mehres_signature.jpg",
    stock_quantity: 15,
    is_active: true,
  },
  {
    id: "33333333-3333-3333-3333-333333333333",
    name: "مجموعة المهراس",
    slug: "the-mehres-set",
    description: "اسألنا على تفاصيل المجموعة المتوفّرة.",
    price_tnd: 95.0,
    image_url: "mehres_set.jpg",
    stock_quantity: 10,
    is_active: true,
  },
];

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    // Return resilient fallback products so storefront remains 100% operational
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        source: "fallback",
        products: FALLBACK_PRODUCTS,
      }),
    };
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase
      .from("products")
      .select("id, name, slug, description, price_tnd, image_url, stock_quantity, is_active")
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (error || !data || data.length === 0) {
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          source: "fallback",
          products: FALLBACK_PRODUCTS,
        }),
      };
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        source: "database",
        products: data,
      }),
    };
  } catch (err) {
    console.error("DARNA: Error fetching products:", err);
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        source: "fallback",
        products: FALLBACK_PRODUCTS,
      }),
    };
  }
};
