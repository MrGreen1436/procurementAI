const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Demo vendors to seed (since CSV had no supplier data)
const DEMO_VENDORS = [
  { supplier_id: 'SUP001', supplier_name: 'GlobalStock Distributors', supplier_phone: '+1-800-555-0101' },
  { supplier_id: 'SUP002', supplier_name: 'FastTrack Wholesale', supplier_phone: '+1-800-555-0102' },
  { supplier_id: 'SUP003', supplier_name: 'PrimeSource Logistics', supplier_phone: '+1-800-555-0103' },
  { supplier_id: 'SUP004', supplier_name: 'NexGen Supply Co.', supplier_phone: '+1-800-555-0104' },
  { supplier_id: 'SUP005', supplier_name: 'Allied Merchant Partners', supplier_phone: '+1-800-555-0105' },
];

async function seedVendors() {
  console.log('Seeding demo vendors...');
  const { error } = await supabase
    .from('vendors')
    .upsert(DEMO_VENDORS, { onConflict: 'supplier_id' });

  if (error) {
    console.error('Error seeding vendors:', error);
    process.exit(1);
  }
  console.log(`Seeded ${DEMO_VENDORS.length} vendors.\n`);
}

async function getTopRiskySKUs() {
  console.log('Querying top 5 highest-risk SKUs from inventory_transactions...');

  // Rank by lowest inventory vs demand_forecast (i.e. most at risk of stockout)
  // Also pull latest price per SKU+store combo for unit_cost
  const { data, error } = await supabase.rpc('get_top_risky_skus').maybeSingle();

  // Fallback: direct query since we don't have an RPC yet
  const { data: rows, error: qErr } = await supabase
    .from('inventory_transactions')
    .select('product_id, store_id, inventory_level, demand_forecast, price, category')
    .eq('date', await getMaxDate())
    .order('inventory_level', { ascending: true })
    .not('demand_forecast', 'is', null)
    .gt('demand_forecast', 0) // only SKUs with positive forecasted demand
    .limit(5);

  if (qErr) {
    console.error('Error querying top SKUs:', qErr);
    process.exit(1);
  }

  return rows;
}

async function getMaxDate() {
  const { data, error } = await supabase
    .from('inventory_transactions')
    .select('date')
    .order('date', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    console.error('Error fetching max date:', error);
    process.exit(1);
  }
  return data.date;
}

function pickSupplier(index) {
  return DEMO_VENDORS[index % DEMO_VENDORS.length];
}

function calcRiskLevel(inventoryLevel, demandForecast) {
  if (inventoryLevel <= 0) return 'high';
  const coverDays = inventoryLevel / demandForecast;
  if (coverDays < 7) return 'high';
  if (coverDays < 14) return 'medium';
  return 'low';
}

async function seedPurchaseOrders(skus) {
  console.log(`\nGenerating purchase orders for ${skus.length} SKUs...`);

  const orders = skus.map((row, i) => {
    const supplier = pickSupplier(i);
    const demandForecast = parseFloat(row.demand_forecast) || 50;
    const quantity = Math.ceil(demandForecast * 1.5); // 1.5x demand forecast
    const unitCost = parseFloat(row.price) || 10.0;
    const totalCost = parseFloat((quantity * unitCost).toFixed(2));
    const riskLevel = calcRiskLevel(row.inventory_level, demandForecast);
    const coverDays = row.inventory_level > 0
      ? Math.round(row.inventory_level / demandForecast)
      : 0;

    return {
      sku: row.product_id,
      sku_name: `${row.category || 'General'} - ${row.product_id}`,
      supplier_id: supplier.supplier_id,
      quantity,
      unit_cost: unitCost,
      total_cost: totalCost,
      risk_level: riskLevel,
      status: 'pending',
      why_supplier: `${supplier.supplier_name} selected due to established lead times and competitive pricing for ${row.category || 'this category'} products.`,
      why_quantity: `Order of ${quantity} units covers ~1.5├ù the current demand forecast of ${demandForecast.toFixed(1)} units/day, providing a safety buffer. Current stock (${row.inventory_level} units) gives only ${coverDays} days of cover.`,
      why_cost: `Unit cost of $${unitCost.toFixed(2)} reflects the latest recorded market price for ${row.product_id}. Total commitment of $${totalCost.toFixed(2)} is within standard reorder thresholds.`,
    };
  });

  const { data, error } = await supabase
    .from('purchase_orders')
    .insert(orders)
    .select('id, sku, supplier_id, quantity, total_cost, risk_level');

  if (error) {
    console.error('Error inserting purchase orders:', error);
    process.exit(1);
  }

  console.log('\nInserted purchase orders:');
  console.table(data);
  console.log(`\nSeeding complete! ${data.length} purchase orders created.`);
}

async function main() {
  await seedVendors();
  const topSKUs = await getTopRiskySKUs();

  if (!topSKUs || topSKUs.length === 0) {
    console.error('No SKUs found in alerts view. Is inventory_transactions populated?');
    process.exit(1);
  }

  console.log(`Top ${topSKUs.length} risky SKUs:`);
  topSKUs.forEach((r, i) =>
    console.log(`  ${i + 1}. ${r.product_id} @ ${r.store_id} | stock: ${r.inventory_level} | forecast: ${r.demand_forecast}`)
  );

  await seedPurchaseOrders(topSKUs);
}

main().catch(console.error);
