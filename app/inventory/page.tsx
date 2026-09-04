"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getInventoryCategorySummary } from "@/lib/api";
import { CategorySummary } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Activity, Plus, Check, X, AlertTriangle, ArrowLeft, Package, ShoppingCart, Gamepad2, Laptop, Smartphone, Tv } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface InventoryRow {
  id?: number;
  date: string;
  store_id: string;
  product_id: string;
  category: string | null;
  region: string | null;
  inventory_level: number;
  reorder_level: number | null;
  price: number | null;
  supplier_name: string | null;
  discount: number | null;
  competitor_pricing: number | null;
  seasonality: string | null;
  weather_condition: string | null;
  holiday_promotion: boolean | null;
  is_anomaly: boolean;
  anomaly_reason: string | null;
}

const getCategoryIcon = (category: string) => {
  const cat = category.toLowerCase();
  if (cat.includes("grocer") || cat.includes("food")) return ShoppingCart;
  if (cat.includes("toy")) return Gamepad2;
  if (cat.includes("electronic") || cat.includes("tech")) return Laptop;
  if (cat.includes("phone") || cat.includes("mobile")) return Smartphone;
  if (cat.includes("tv") || cat.includes("television")) return Tv;
  return Package;
};

const formatCurrency = (val: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(val);

export default function InventoryPage() {
  const [transactions, setTransactions] = useState<InventoryRow[]>([]);
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Form state
  const [storeId, setStoreId] = useState("");
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    
    // Fetch summary
    const summary = await getInventoryCategorySummary();
    setCategories(summary);

    // Fetch transactions
    const { data, error } = await supabase
      .from("inventory_transactions")
      .select(`
        date, 
        store_id, 
        product_id, 
        category,
        region,
        inventory_level, 
        reorder_level,
        price, 
        discount,
        competitor_pricing,
        seasonality,
        weather_condition,
        holiday_promotion,
        is_anomaly,
        anomaly_reason,
        vendors (supplier_name)
      `)
      .order("date", { ascending: false })
      .limit(300); // Fetch a bit more to ensure we have data across categories

    if (data) {
      const mapped = data.map((row: any) => ({
        ...row,
        supplier_name: row.vendors?.supplier_name || null,
      }));
      setTransactions(mapped);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleAdjustStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeId || !productId || !qty) return;

    setIsSubmitting(true);
    
    const { error } = await supabase.from("inventory_transactions").insert({
      store_id: storeId,
      product_id: productId,
      inventory_level: parseInt(qty, 10),
      is_anomaly: false,
      date: new Date().toISOString()
    });

    if (error) {
      toast.error("Failed to add manual adjustment");
      console.error(error);
    } else {
      toast.success("Stock adjustment logged successfully");
      setStoreId("");
      setProductId("");
      setQty("");
      fetchData();
    }
    
    setIsSubmitting(false);
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleDateString("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  };

  const filteredTransactions = selectedCategory
    ? transactions.filter((t) => (t.category || "Uncategorized") === selectedCategory)
    : transactions;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl font-bold tracking-tight font-heading">Inventory Registry</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {selectedCategory ? `Viewing SKUs in ${selectedCategory}` : "Select a category to drill down."}
        </p>
      </div>

      {!selectedCategory ? (
        // LEVEL 1: Category Grid
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {loading && categories.length === 0 ? (
              <div className="col-span-full text-center text-muted-foreground py-10">Loading categories...</div>
            ) : categories.length === 0 ? (
              <div className="col-span-full text-center text-muted-foreground py-10">No categories yet — upload a dataset.</div>
            ) : (
              categories.map((cat) => {
                const Icon = getCategoryIcon(cat.category);
                const hasRisk = cat.atRiskCount > 0;
                return (
                  <Card
                    key={cat.category}
                    className={cn(
                      "cursor-pointer hover:bg-card/80 transition-all shadow-[0_0_15px_rgba(255,182,39,0.05)] border-l-4 overflow-hidden relative",
                      hasRisk ? "border-l-red-500 shadow-[0_0_15px_rgba(239,68,68,0.1)]" : "border-l-primary"
                    )}
                    onClick={() => setSelectedCategory(cat.category)}
                  >
                    {hasRisk && <div className="absolute inset-0 bg-red-500/5 pointer-events-none" />}
                    <CardHeader className="pb-2 relative z-10">
                      <CardTitle className="text-base font-semibold font-heading flex items-center justify-between">
                        {cat.category}
                        <Icon className={cn("h-4 w-4", hasRisk ? "text-red-500" : "text-muted-foreground")} />
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="relative z-10 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <p className="text-xs text-muted-foreground">SKUs</p>
                          <p className="font-semibold">{cat.skuCount}</p>
                        </div>
                        <div className="space-y-0.5 text-right">
                          <p className="text-xs text-muted-foreground">At Risk</p>
                          <p className={cn("font-semibold", hasRisk ? "text-red-500 text-glow-red" : "")}>
                            {cat.atRiskCount}
                          </p>
                        </div>
                      </div>
                      <div className="pt-2 border-t border-border/50">
                        <p className="text-xs text-muted-foreground">Total Value</p>
                        <p className="font-semibold text-lg">{formatCurrency(cat.totalValue)}</p>
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
        </div>
      ) : (
        // LEVEL 2: Drilled-in Table
        <div className="space-y-4">
          <button
            onClick={() => setSelectedCategory(null)}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Categories
          </button>
          
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            <div className="lg:col-span-3">
              <Card className="shadow-[0_0_15px_rgba(255,182,39,0.05)] h-full relative overflow-hidden flex flex-col">
                <div className="absolute inset-0 bg-primary/5 pointer-events-none" />
                <CardHeader className="relative z-10 border-b border-border/50 shrink-0">
                  <CardTitle className="text-base font-semibold font-heading flex items-center gap-2">
                    <Activity className="h-4 w-4 text-primary" />
                    {selectedCategory} Transaction History
                  </CardTitle>
                </CardHeader>
                <CardContent className="relative z-10 p-0 flex-1 h-0">
                  <div className="h-[600px] overflow-auto relative">
                    {loading ? (
                      <div className="flex justify-center items-center h-full text-muted-foreground">Loading...</div>
                    ) : filteredTransactions.length === 0 ? (
                      <div className="flex justify-center items-center h-full text-muted-foreground">No recent transactions.</div>
                    ) : (
                      <Table className="w-max min-w-full">
                        <TableHeader className="bg-background/95 sticky top-0 z-30 backdrop-blur">
                          <TableRow className="border-b-border/30 hover:bg-transparent">
                            <TableHead className="sticky left-0 bg-background/95 backdrop-blur z-40 pl-6 min-w-[120px] max-w-[120px] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.3)]">Date</TableHead>
                            <TableHead className="sticky left-[120px] bg-background/95 backdrop-blur z-40 min-w-[100px] max-w-[100px] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.3)]">Store ID</TableHead>
                            <TableHead className="sticky left-[220px] bg-background/95 backdrop-blur z-40 min-w-[130px] max-w-[130px] shadow-[4px_0_6px_-3px_rgba(0,0,0,0.4)] border-r border-border/30">Product ID</TableHead>
                            <TableHead className="min-w-[100px]">Region</TableHead>
                            <TableHead className="text-right min-w-[120px]">Inventory Level</TableHead>
                            <TableHead className="text-right min-w-[120px]">Reorder Level</TableHead>
                            <TableHead className="min-w-[180px]">Supplier</TableHead>
                            <TableHead className="text-right min-w-[100px]">Price</TableHead>
                            <TableHead className="text-right min-w-[100px]">Discount</TableHead>
                            <TableHead className="text-right min-w-[130px]">Comp. Pricing</TableHead>
                            <TableHead className="min-w-[120px]">Seasonality</TableHead>
                            <TableHead className="min-w-[140px]">Weather</TableHead>
                            <TableHead className="text-center min-w-[100px]">Promo</TableHead>
                            <TableHead className="text-center min-w-[100px]">Anomaly</TableHead>
                            <TableHead className="min-w-[200px] pr-6">Anomaly Reason</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredTransactions.map((tx, idx) => (
                            <TableRow key={idx} className="border-b-border/30 hover:bg-muted/30">
                              <TableCell className="sticky left-0 bg-card z-20 pl-6 text-muted-foreground text-xs min-w-[120px] max-w-[120px] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.3)] group-hover:bg-muted/30">
                                {formatDate(tx.date)}
                              </TableCell>
                              <TableCell className="sticky left-[120px] bg-card z-20 font-medium text-sm min-w-[100px] max-w-[100px] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.3)] group-hover:bg-muted/30">
                                {tx.store_id}
                              </TableCell>
                              <TableCell className="sticky left-[220px] bg-card z-20 text-sm min-w-[130px] max-w-[130px] shadow-[4px_0_6px_-3px_rgba(0,0,0,0.4)] border-r border-border/30 group-hover:bg-muted/30">
                                {tx.product_id}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">{tx.region || "-"}</TableCell>
                              <TableCell className="text-right tabular-nums text-sm font-medium">
                                {tx.inventory_level}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                                {tx.reorder_level ?? "-"}
                              </TableCell>
                              <TableCell className="text-xs truncate max-w-[180px]">
                                {tx.supplier_name || "-"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                                {tx.price ? `$${Number(tx.price).toFixed(2)}` : "-"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                                {tx.discount ? `${(Number(tx.discount) * 100).toFixed(0)}%` : "-"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                                {tx.competitor_pricing ? `$${Number(tx.competitor_pricing).toFixed(2)}` : "-"}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground capitalize">{tx.seasonality || "-"}</TableCell>
                              <TableCell className="text-xs text-muted-foreground capitalize">{tx.weather_condition || "-"}</TableCell>
                              <TableCell className="text-center">
                                {tx.holiday_promotion === true ? (
                                  <Check className="h-4 w-4 text-emerald-500 mx-auto" />
                                ) : tx.holiday_promotion === false ? (
                                  <X className="h-4 w-4 text-muted-foreground/40 mx-auto" />
                                ) : (
                                  <span className="text-muted-foreground">-</span>
                                )}
                              </TableCell>
                              <TableCell className="text-center">
                                {tx.is_anomaly ? (
                                  <div className="flex justify-center">
                                    <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 gap-1 text-[10px] px-1.5 py-0">
                                      <AlertTriangle className="h-3 w-3" />
                                      Yes
                                    </Badge>
                                  </div>
                                ) : null}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground truncate max-w-[200px] pr-6">
                                {tx.is_anomaly ? (tx.anomaly_reason || "-") : ""}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="lg:col-span-1">
              <Card className="shadow-sm border-t-4 border-t-primary/80">
                <CardHeader>
                  <CardTitle className="text-base font-semibold font-heading">Manual Adjustment</CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleAdjustStock} className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">Store ID</label>
                      <input
                        type="text"
                        required
                        value={storeId}
                        onChange={(e) => setStoreId(e.target.value)}
                        className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                        placeholder="e.g. S001"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">Product ID</label>
                      <input
                        type="text"
                        required
                        value={productId}
                        onChange={(e) => setProductId(e.target.value)}
                        className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                        placeholder="e.g. SKU-LITH-007"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">New Inventory Level</label>
                      <input
                        type="number"
                        required
                        value={qty}
                        onChange={(e) => setQty(e.target.value)}
                        className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                        placeholder="e.g. 150"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full mt-2 inline-flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold h-9 px-4 hover:bg-primary/90 transition-colors disabled:opacity-50"
                    >
                      <Plus className="h-4 w-4" />
                      {isSubmitting ? "Logging..." : "Log Receipt"}
                    </button>
                  </form>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
