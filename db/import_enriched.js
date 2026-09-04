const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const csv = require('csv-parser');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const CSV_FILE_PATH = 'data/retail_store_inventory_enriched.csv';
const BATCH_SIZE = 500;

function parseBoolean(val) {
  if (!val) return false;
  const lower = val.toString().toLowerCase().trim();
  return lower === '1' || lower === 'true' || lower === 'yes';
}

async function startImport() {
  console.log(`Starting First Pass: Extracting unique vendors from ${CSV_FILE_PATH}...`);
  
  const vendorsMap = new Map();
  
  // First pass: extract unique vendors
  await new Promise((resolve, reject) => {
    fs.createReadStream(CSV_FILE_PATH)
      .pipe(csv())
      .on('data', (data) => {
        const supplierId = data['Supplier ID'];
        if (supplierId && !vendorsMap.has(supplierId)) {
          vendorsMap.set(supplierId, {
            supplier_id: supplierId,
            supplier_name: data['Supplier Name'] || null,
            supplier_phone: data['Supplier Phone'] || null
          });
        }
      })
      .on('end', resolve)
      .on('error', reject);
  });

  const uniqueVendors = Array.from(vendorsMap.values());
  console.log(`Found ${uniqueVendors.length} unique vendors. Upserting to 'vendors' table...`);

  let totalVendorsInserted = 0;
  for (let i = 0; i < uniqueVendors.length; i += BATCH_SIZE) {
    const batch = uniqueVendors.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('vendors')
      .upsert(batch, { onConflict: 'supplier_id' });
      
    if (error) {
      console.error(`Error upserting vendors (batch starting at index ${i}):`, error);
      process.exit(1);
    }
    totalVendorsInserted += batch.length;
  }
  
  console.log(`Successfully upserted ${totalVendorsInserted} vendors.\n`);
  console.log(`Starting Second Pass: Importing transactions into 'inventory_transactions'...`);

  let rows = [];
  let batchCount = 0;
  let totalInserted = 0;

  async function processBatch(batch) {
    const { error } = await supabase
      .from('inventory_transactions')
      .insert(batch);

    if (error) {
      console.error(`Error inserting batch ${batchCount + 1}:`, error);
      process.exit(1);
    }

    batchCount++;
    totalInserted += batch.length;
    console.log(`Inserted batch ${batchCount} (${batch.length} rows). Total transactions inserted so far: ${totalInserted}`);
  }

  // Second pass: insert transactions
  const parser = fs.createReadStream(CSV_FILE_PATH).pipe(csv());

  for await (const data of parser) {
    const mappedRow = {
      date: data['Date'] || null,
      store_id: data['Store ID'] || null,
      product_id: data['Product ID'] || null,
      category: data['Category'] || null,
      region: data['Region'] || null,
      inventory_level: data['Inventory Level'] ? parseInt(data['Inventory Level'], 10) : null,
      units_sold: data['Units Sold'] ? parseInt(data['Units Sold'], 10) : null,
      units_ordered: data['Units Ordered'] ? parseInt(data['Units Ordered'], 10) : null,
      demand_forecast: data['Demand Forecast'] ? parseFloat(data['Demand Forecast']) : null,
      price: data['Price'] ? parseFloat(data['Price']) : null,
      discount: data['Discount'] ? parseFloat(data['Discount']) : null,
      weather_condition: data['Weather Condition'] || null,
      holiday_promotion: parseBoolean(data['Holiday/Promotion']),
      competitor_pricing: data['Competitor Pricing'] ? parseFloat(data['Competitor Pricing']) : null,
      seasonality: data['Seasonality'] || null,
      supplier_id: data['Supplier ID'] || null,
      lead_time_days: data['Lead Time Days'] ? parseInt(data['Lead Time Days'], 10) : null,
      reorder_level: data['Reorder Level'] ? parseInt(data['Reorder Level'], 10) : null,
      hours_since_update: data['Hours Since Update'] ? parseFloat(data['Hours Since Update']) : null,
      mismatch_count: data['Mismatch Count'] ? parseInt(data['Mismatch Count'], 10) : null,
      last_known_price: data['Last Known Price'] ? parseFloat(data['Last Known Price']) : null,
      is_anomaly: parseBoolean(data['Is Anomaly']),
      anomaly_reason: (data['Anomaly Reason'] && data['Anomaly Reason'].trim() !== '') ? data['Anomaly Reason'].trim() : null
    };

    rows.push(mappedRow);

    if (rows.length === BATCH_SIZE) {
      await processBatch(rows);
      rows = []; // Clear the batch array
    }
  }

  // Insert any remaining rows in the last batch
  if (rows.length > 0) {
    await processBatch(rows);
  }

  console.log(`\nImport complete!`);
  console.log(`Final Row Counts:`);
  console.log(`- vendors: ${totalVendorsInserted}`);
  console.log(`- inventory_transactions: ${totalInserted}`);
}

startImport().catch(console.error);
