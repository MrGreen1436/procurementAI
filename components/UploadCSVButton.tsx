"use client";

import { useState, useRef } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import * as Papa from "papaparse";

export function UploadCSVButton() {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    toast.info("Uploading dataset...", { duration: 10000 });

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          // Assuming the CSV columns map exactly to DB columns, 
          // or we handle some basic capitalization fallback
          const rows = results.data.map((row: any) => ({
            date: row.date || row.Date || null,
            store_id: row.store_id || row['Store ID'] || null,
            product_id: row.product_id || row['Product ID'] || null,
            category: row.category || row.Category || null,
            region: row.region || row.Region || null,
            inventory_level: parseInt(row.inventory_level || row['Inventory Level'] || "0", 10),
            reorder_level: row.reorder_level || row['Reorder Level'] ? parseInt(row.reorder_level || row['Reorder Level'], 10) : null,
            price: row.price || row.Price ? parseFloat(row.price || row.Price) : null,
            discount: row.discount || row.Discount ? parseFloat(row.discount || row.Discount) : null,
            competitor_pricing: row.competitor_pricing || row['Competitor Pricing'] ? parseFloat(row.competitor_pricing || row['Competitor Pricing']) : null,
            seasonality: row.seasonality || row.Seasonality || null,
            weather_condition: row.weather_condition || row['Weather Condition'] || null,
            holiday_promotion: row.holiday_promotion === 'true' || row['Holiday/Promotion'] === 'true' || row.holiday_promotion === '1' ? true : false,
            is_anomaly: row.is_anomaly === 'true' || row['Is Anomaly'] === 'true' || row.is_anomaly === '1' ? true : false,
            anomaly_reason: row.anomaly_reason || row['Anomaly Reason'] || null,
            supplier_id: row.supplier_id || row['Supplier ID'] || null
          }));

          // Extract unique supplier_ids
          const uniqueSupplierIds = Array.from(new Set(rows.map((r: any) => r.supplier_id).filter(Boolean)));
          
          if (uniqueSupplierIds.length > 0) {
            const vendorsData = uniqueSupplierIds.map((id) => ({
              supplier_id: id,
              supplier_name: `Supplier ${id}` // fallback name since it's just an ID
            }));

            // Upsert into vendors table to satisfy foreign key constraints
            const { error: vendorError } = await supabase
              .from("vendors")
              .upsert(vendorsData, { onConflict: "supplier_id" });
              
            if (vendorError) {
              console.error("Vendor upsert error:", vendorError);
              throw new Error("Failed to populate vendors table: " + vendorError.message);
            }
          }

          // Insert in chunks of 500
          const chunkSize = 500;
          let inserted = 0;
          for (let i = 0; i < rows.length; i += chunkSize) {
            const chunk = rows.slice(i, i + chunkSize);
            const { error } = await supabase.from("inventory_transactions").insert(chunk);
            if (error) throw error;
            inserted += chunk.length;
          }

          toast.success(`Successfully uploaded ${inserted} rows!`);
          setTimeout(() => {
            window.location.reload();
          }, 1500);
        } catch (err: any) {
          toast.error("Upload failed: " + err.message);
          console.error(err);
        } finally {
          setUploading(false);
          if (fileInputRef.current) fileInputRef.current.value = "";
        }
      },
      error: (error) => {
        toast.error("Failed to parse CSV: " + error.message);
        setUploading(false);
      }
    });
  };

  return (
    <>
      <input
        type="file"
        accept=".csv"
        className="hidden"
        ref={fileInputRef}
        onChange={handleFileChange}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className="inline-flex items-center gap-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold px-3 py-2 transition-colors disabled:opacity-50"
      >
        <Upload className="h-3.5 w-3.5" />
        {uploading ? "Uploading..." : "Upload Dataset"}
      </button>
    </>
  );
}
