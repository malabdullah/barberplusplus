import "jsr:@supabase/functions-js@2.89.0/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.89.0";
import { getAppUrl } from "../_shared/environment.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": getAppUrl(),
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const KUWAIT_GOVERNORATES = [
  {
    id: 1,
    name_en: "Al Asimah",
    name_ar: "العاصمة",
    code: "KW-KU",
    areas: [
      { id: 101, name_en: "Kuwait City", name_ar: "مدينة الكويت" },
      { id: 102, name_en: "Sharq", name_ar: "شرق" },
      { id: 103, name_en: "Mirqab", name_ar: "المرقاب" },
      { id: 104, name_en: "Dasman", name_ar: "دسمان" },
      { id: 105, name_en: "Shuwaikh", name_ar: "الشويخ" },
      { id: 106, name_en: "Bneid Al-Gar", name_ar: "بنيد القار" },
      { id: 107, name_en: "Kaifan", name_ar: "كيفان" },
      { id: 108, name_en: "Shamiya", name_ar: "الشامية" },
      { id: 109, name_en: "Rawda", name_ar: "الروضة" },
      { id: 110, name_en: "Adiliya", name_ar: "العديلية" },
      { id: 111, name_en: "Khaldiya", name_ar: "الخالدية" },
      { id: 112, name_en: "Qortuba", name_ar: "قرطبة" },
      { id: 113, name_en: "Surra", name_ar: "السرة" },
      { id: 114, name_en: "Yarmouk", name_ar: "اليرموك" },
      { id: 115, name_en: "Shuwaikh Industrial", name_ar: "الشويخ الصناعية" },
      { id: 116, name_en: "Doha", name_ar: "الدوحة" },
      { id: 117, name_en: "North West Sulaibikhat", name_ar: "شمال غرب الصليبخات" },
      { id: 118, name_en: "Faiha", name_ar: "الفيحاء" },
      { id: 119, name_en: "Mansouriya", name_ar: "المنصورية" },
      { id: 120, name_en: "Nuzha", name_ar: "النزهة" },
      { id: 121, name_en: "Abdullah Al-Salem", name_ar: "عبدالله السالم" },
      { id: 122, name_en: "Qadsiya", name_ar: "القادسية" },
      { id: 123, name_en: "Daiya", name_ar: "الدعية" },
    ],
  },
  {
    id: 2,
    name_en: "Hawalli",
    name_ar: "حولي",
    code: "KW-HA",
    areas: [
      { id: 201, name_en: "Hawalli", name_ar: "حولي" },
      { id: 202, name_en: "Salmiya", name_ar: "السالمية" },
      { id: 203, name_en: "Rumaithiya", name_ar: "الرميثية" },
      { id: 204, name_en: "Jabriya", name_ar: "الجابرية" },
      { id: 205, name_en: "Salwa", name_ar: "سلوى" },
      { id: 206, name_en: "Bayan", name_ar: "بيان" },
      { id: 207, name_en: "Mishref", name_ar: "مشرف" },
      { id: 208, name_en: "Shaab", name_ar: "الشعب" },
      { id: 209, name_en: "Hitteen", name_ar: "حطين" },
      { id: 210, name_en: "Zahra", name_ar: "الزهراء" },
      { id: 211, name_en: "Shuhada", name_ar: "الشهداء" },
      { id: 212, name_en: "Bedaa", name_ar: "البدع" },
      { id: 213, name_en: "Mubarak Al-Abdullah", name_ar: "مبارك العبدالله" },
      { id: 214, name_en: "Siddiq", name_ar: "الصديق" },
    ],
  },
  {
    id: 3,
    name_en: "Farwaniya",
    name_ar: "الفروانية",
    code: "KW-FA",
    areas: [
      { id: 301, name_en: "Farwaniya", name_ar: "الفروانية" },
      { id: 302, name_en: "Khaitan", name_ar: "خيطان" },
      { id: 303, name_en: "Jleeb Al-Shuyoukh", name_ar: "جليب الشيوخ" },
      { id: 304, name_en: "Ardiya", name_ar: "العارضية" },
      { id: 305, name_en: "Rai", name_ar: "الري" },
      { id: 306, name_en: "Riggai", name_ar: "الرقعي" },
      { id: 307, name_en: "Omariya", name_ar: "العمرية" },
      { id: 308, name_en: "Andalus", name_ar: "الأندلس" },
      { id: 309, name_en: "Rabiya", name_ar: "الرابية" },
      { id: 310, name_en: "Ishbiliya", name_ar: "اشبيلية" },
      { id: 311, name_en: "Sabah Al-Nasser", name_ar: "صباح الناصر" },
      { id: 312, name_en: "Abdullah Al-Mubarak", name_ar: "عبدالله المبارك" },
      { id: 313, name_en: "Firdous", name_ar: "الفردوس" },
      { id: 314, name_en: "Hasawi", name_ar: "الحساوي" },
      { id: 315, name_en: "Dajeej", name_ar: "الضجيج" },
      { id: 316, name_en: "South Khaitan", name_ar: "جنوب خيطان" },
    ],
  },
  {
    id: 4,
    name_en: "Mubarak Al-Kabeer",
    name_ar: "مبارك الكبير",
    code: "KW-MU",
    areas: [
      { id: 401, name_en: "Qurain", name_ar: "القرين" },
      { id: 402, name_en: "Adan", name_ar: "العدان" },
      { id: 403, name_en: "Qusour", name_ar: "القصور" },
      { id: 404, name_en: "Sabah Al-Salem", name_ar: "صباح السالم" },
      { id: 405, name_en: "Messila", name_ar: "المسيلة" },
      { id: 406, name_en: "Fnaitees", name_ar: "الفنيطيس" },
      { id: 407, name_en: "Abu Fatira", name_ar: "أبو فطيرة" },
      { id: 408, name_en: "Mubarak Al-Kabeer", name_ar: "مبارك الكبير" },
      { id: 409, name_en: "Sabhan Industrial", name_ar: "صبحان الصناعية" },
      { id: 410, name_en: "Wista", name_ar: "الوسطى" },
      { id: 411, name_en: "South Wista", name_ar: "جنوب الوسطى" },
      { id: 412, name_en: "Abu Hassaniya", name_ar: "أبو حسنية" },
    ],
  },
  {
    id: 5,
    name_en: "Ahmadi",
    name_ar: "الأحمدي",
    code: "KW-AH",
    areas: [
      { id: 501, name_en: "Ahmadi", name_ar: "الأحمدي" },
      { id: 502, name_en: "Mangaf", name_ar: "المنقف" },
      { id: 503, name_en: "Fahaheel", name_ar: "الفحيحيل" },
      { id: 504, name_en: "Mahboula", name_ar: "المهبولة" },
      { id: 505, name_en: "Fintas", name_ar: "الفنطاس" },
      { id: 506, name_en: "Abu Halifa", name_ar: "أبو حليفة" },
      { id: 507, name_en: "Riqqa", name_ar: "الرقة" },
      { id: 508, name_en: "Hadiya", name_ar: "هدية" },
      { id: 509, name_en: "Sabahiya", name_ar: "الصباحية" },
      { id: 510, name_en: "Egaila", name_ar: "العقيلة" },
      { id: 511, name_en: "Jaber Al-Ali", name_ar: "جابر العلي" },
      { id: 512, name_en: "Fahd Al-Ahmad", name_ar: "فهد الأحمد" },
      { id: 513, name_en: "Ali Sabah Al-Salem", name_ar: "علي صباح السالم" },
      { id: 514, name_en: "Wafra", name_ar: "الوفرة" },
      { id: 515, name_en: "Zour", name_ar: "الزور" },
      { id: 516, name_en: "Khairan", name_ar: "الخيران" },
      { id: 517, name_en: "Nuwaiseeb", name_ar: "النويصيب" },
      { id: 518, name_en: "Shuaiba", name_ar: "الشعيبة" },
      { id: 519, name_en: "Mina Abdullah", name_ar: "ميناء عبدالله" },
      { id: 520, name_en: "Bnaider", name_ar: "بنيدر" },
    ],
  },
  {
    id: 6,
    name_en: "Jahra",
    name_ar: "الجهراء",
    code: "KW-JA",
    areas: [
      { id: 601, name_en: "Jahra", name_ar: "الجهراء" },
      { id: 602, name_en: "Sulaibiya", name_ar: "الصليبية" },
      { id: 603, name_en: "Naseem", name_ar: "النسيم" },
      { id: 604, name_en: "Qasr", name_ar: "القصر" },
      { id: 605, name_en: "Taima", name_ar: "تيماء" },
      { id: 606, name_en: "Waha", name_ar: "الواحة" },
      { id: 607, name_en: "Naeem", name_ar: "النعيم" },
      { id: 608, name_en: "Qairawan", name_ar: "القيروان" },
      { id: 609, name_en: "Oyoun", name_ar: "العيون" },
      { id: 610, name_en: "South Doha", name_ar: "جنوب الدوحة" },
      { id: 611, name_en: "Saad Al-Abdullah", name_ar: "سعد العبدالله" },
      { id: 612, name_en: "Jaber Al-Ahmad", name_ar: "جابر الأحمد" },
      { id: 613, name_en: "Mutlaa", name_ar: "المطلاع" },
      { id: 614, name_en: "Kabd", name_ar: "كبد" },
      { id: 615, name_en: "Amghara", name_ar: "أمغرة" },
      { id: 616, name_en: "Abdali", name_ar: "العبدلي" },
      { id: 617, name_en: "Salmi", name_ar: "السالمي" },
      { id: 618, name_en: "Subiya", name_ar: "الصبية" },
    ],
  },
];

// Create Supabase client with service role for database operations
function getSupabaseClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(supabaseUrl, supabaseServiceKey);
}

// Sync data to database
async function syncToDatabase() {
  const supabase = getSupabaseClient();

  // Delete existing data (areas first due to FK constraint)
  await supabase.from("areas").delete().neq("id", 0);
  await supabase.from("governorates").delete().neq("id", 0);

  // Insert governorates
  const governoratesData = KUWAIT_GOVERNORATES.map((g) => ({
    id: g.id,
    name_en: g.name_en,
    name_ar: g.name_ar,
    code: g.code,
  }));

  const { error: govError } = await supabase
    .from("governorates")
    .insert(governoratesData);

  if (govError) {
    throw new Error(`Failed to insert governorates: ${govError.message}`);
  }

  // Insert all areas
  const areasData = KUWAIT_GOVERNORATES.flatMap((g) =>
    g.areas.map((a) => ({
      id: a.id,
      governorate_id: g.id,
      name_en: a.name_en,
      name_ar: a.name_ar,
    }))
  );

  const { error: areasError } = await supabase.from("areas").insert(areasData);

  if (areasError) {
    throw new Error(`Failed to insert areas: ${areasError.message}`);
  }

  return {
    governorates: governoratesData.length,
    areas: areasData.length,
  };
}

// Get data from database
async function getFromDatabase(lang: string, includeAreas: boolean, governorateId?: number) {
  const supabase = getSupabaseClient();

  let query = supabase.from("governorates").select(
    includeAreas ? "*, areas(*)" : "*"
  );

  if (governorateId) {
    query = query.eq("id", governorateId);
  }

  const { data, error } = await query.order("id");

  if (error) {
    throw new Error(`Failed to fetch data: ${error.message}`);
  }

  // Transform based on language
  return data?.map((gov: any) => {
    const base = {
      id: gov.id,
      name: lang === "ar" ? gov.name_ar : gov.name_en,
      name_en: gov.name_en,
      name_ar: gov.name_ar,
      code: gov.code,
    };

    if (includeAreas && gov.areas) {
      return {
        ...base,
        areas: gov.areas.map((area: any) => ({
          id: area.id,
          name: lang === "ar" ? area.name_ar : area.name_en,
          name_en: area.name_en,
          name_ar: area.name_ar,
        })),
      };
    }

    return base;
  });
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    // POST with action=sync - sync data to database
    if (req.method === "POST" && action === "sync") {
      const result = await syncToDatabase();
      return new Response(
        JSON.stringify({
          success: true,
          message: "Data synced to database successfully",
          synced: result,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    // GET - fetch data from database (or static if empty)
    const lang = url.searchParams.get("lang") || "en";
    const includeAreas = url.searchParams.get("areas") !== "false";
    const governorateId = url.searchParams.get("governorate_id");

    let data;
    try {
      data = await getFromDatabase(
        lang,
        includeAreas,
        governorateId ? parseInt(governorateId, 10) : undefined
      );
    } catch {
      // Fallback to static data if database is empty or errors
      data = null;
    }

    // If no data from database, use static data
    if (!data || data.length === 0) {
      let result = KUWAIT_GOVERNORATES;

      if (governorateId) {
        const id = parseInt(governorateId, 10);
        result = result.filter((g) => g.id === id);
      }

      data = result.map((gov) => {
        const base = {
          id: gov.id,
          name: lang === "ar" ? gov.name_ar : gov.name_en,
          name_en: gov.name_en,
          name_ar: gov.name_ar,
          code: gov.code,
        };

        if (includeAreas) {
          return {
            ...base,
            areas: gov.areas.map((area) => ({
              id: area.id,
              name: lang === "ar" ? area.name_ar : area.name_en,
              name_en: area.name_en,
              name_ar: area.name_ar,
            })),
          };
        }

        return base;
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        count: data.length,
        language: lang,
        source: "database",
        data: governorateId ? data[0] || null : data,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "An error occurred";
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
});
