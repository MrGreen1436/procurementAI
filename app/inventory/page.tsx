"use client";

import { useEffect, useState } from "react";
import {
  getInventoryCategorySummary,
  fetchInventoryTransactions,
  adjustStock,
  fetchInventoryStatus,
  resetInventoryDataset,
  fetchWarehouses,
} from "@/lib/api";
import { CategorySummary, InventoryRow, InventoryDatasetStatus } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Check,
  X,
  AlertTriangle,
  ArrowLeft,
  Package,
  ShoppingCart,
  Gamepad2,
  Laptop,
  Smartphone,
  Tv,
  RotateCcw,
  FileSpreadsheet,
  Layers,
  Database,
  Search,
  Building2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { UploadCSVButton } from "@/components/UploadCSVButton";

const getCategoryIcon = (category: string) => {
  const cat = category.toLowerCase();
  if (cat.includes("grocer") || cat.includes("food")) return ShoppingCart;
  if (cat.includes("toy") || cat.includes("game")) return Gamepad2;
  if (cat.includes("electronic") || cat.includes("tech") || cat.includes("appl")) return Laptop;
  if (cat.includes("phone") || cat.includes("mobile") || cat.includes("access")) return Smartphone;
  if (cat.includes("tv") || cat.includes("television") || cat.includes("screen")) return Tv;
  return Package;
};

const formatCurrency = (val: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(val);

export default function InventoryPage() {
  const [transactions, setTransactions] = useState<InventoryRow[]>([]);
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [status, setStatus] = useState<InventoryDatasetStatus>({ has_dataset: false });
  const [loading, setLoading] = useState(true);
  
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState<string | null>(null);

  // Form state for manual adjustment
  const [storeId, setStoreId] = useState("");
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [dsStatus, summary, txList, whList] = await Promise.all([
        fetchInventoryStatus(),
        getInventoryCategorySummary(selectedWarehouse || undefined),
        fetchInventoryTransactions(selectedCategory || undefined, selectedWarehouse || undefined),
        fetchWarehouses(),
      ]);
      setStatus(dsStatus);
      setCategories(summary);
      setTransactions(txList);
      setWarehouses(whList);
    } catch (err) {
      console.error("Error loading inventory:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedWarehouse, selectedCategory]);

  const handleAdjustStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeId || !productId || !qty) return;

    setIsSubmitting(true);
    try {
      await adjustStock({
        store_id: storeId,
        product_id: productId,
        inventory_level: parseInt(qty, 10),
      });
      toast.success("Stock adjustment logged successfully", {
        description: `Updated ${productId} stock to ${qty} units.`,
      });
      setStoreId("");
      setProductId("");
      setQty("");
      fetchData();
    } catch (err: any) {
      toast.error("Failed to add manual adjustment", {
        description: err.message,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetDataset = async () => {
    if (!confirm("Reset to empty state? This removes the uploaded dataset to test the zero-hardcode state.")) return;
    try {
      await resetInventoryDataset();
      toast.info("Dataset cleared", { description: "Inventory is now in empty state." });
      setSelectedCategory(null);
      fetchData();
    } catch (err: any) {
      toast.error("Reset failed", { description: err.message });
    }
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return "-";
    try {
      return new Date(dateString).toLocaleDateString("en-US", {
        timeZone: "UTC",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return dateString;
    }
  };

  const filteredTransactions = transactions
    .filter((t) => (selectedCategory ? (t.category || "General Supplies") === selectedCategory : true))
    .filter((t) => {
      if (!searchTerm) return true;
      const q = searchTerm.toLowerCase();
      return (
        t.product_id?.toLowerCase().includes(q) ||
        t.store_id?.toLowerCase().includes(q) ||
        t.region?.toLowerCase().includes(q) ||
        t.supplier_name?.toLowerCase().includes(q)
      );
    });

  const totalSKUs = categories.reduce((sum, c) => sum + c.skuCount, 0);
  const totalAtRisk = categories.reduce((sum, c) => sum + c.atRiskCount, 0);
  const totalValuation = categories.reduce((sum, c) => sum + c.totalValue, 0);

  return (
    <div className="space-y-6">
      {/* ── Page Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight">Inventory Registry</h1>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-full">
              <Database className="h-3 w-3" /> Live Database ({status.row_count ? status.row_count.toLocaleString() : "Connected"})
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {selectedCategory
              ? `Viewing SKUs and stock records in ${selectedCategory}`
              : "Explore SKU registry, real-time category risk, and stock reconciliations powered by database"}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <UploadCSVButton onUploadSuccess={fetchData} />
          {status.has_dataset && (
            <button
              type="button"
              onClick={handleResetDataset}
              title="Reset inventory records"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card hover:bg-muted text-muted-foreground text-xs font-semibold px-3 py-2 transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </button>
          )}
        </div>
      </div>

      {/* ── Summary Stats Pills ── */}
      {categories.length > 0 && !selectedCategory && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="p-4 shadow-sm border bg-card/60 backdrop-blur-sm">
            <div className="text-xs font-medium text-muted-foreground">Categories</div>
            <div className="text-2xl font-bold mt-1 text-foreground">{categories.length}</div>
          </Card>
          <Card className="p-4 shadow-sm border bg-card/60 backdrop-blur-sm">
            <div className="text-xs font-medium text-muted-foreground">Monitored SKUs</div>
            <div className="text-2xl font-bold mt-1 text-blue-400">{totalSKUs}</div>
          </Card>
          <Card className="p-4 shadow-sm border bg-card/60 backdrop-blur-sm">
            <div className="text-xs font-medium text-muted-foreground">At-Risk Categories</div>
            <div className="text-2xl font-bold mt-1 text-red-400">{totalAtRisk}</div>
          </Card>
          <Card className="p-4 shadow-sm border bg-card/60 backdrop-blur-sm">
            <div className="text-xs font-medium text-muted-foreground">Total Stock Value</div>
            <div className="text-2xl font-bold mt-1 text-emerald-400">{formatCurrency(totalValuation)}</div>
          </Card>
        </div>
      )}

      {/* ── Warehouse Cards ── */}
      {warehouses.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              Project Sites / Warehouses
            </h2>
            {selectedWarehouse && (
              <button
                onClick={() => setSelectedWarehouse(null)}
                className="text-xs text-primary hover:underline"
              >
                Clear filter
              </button>
            )}
          </div>
          <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin">
            {warehouses.map((wh) => (
              <Card
                key={wh.store_id}
                onClick={() => setSelectedWarehouse(selectedWarehouse === wh.store_id ? null : wh.store_id)}
                className={cn(
                  "cursor-pointer shrink-0 w-64 p-4 shadow-sm transition-all border-l-4",
                  selectedWarehouse === wh.store_id ? "ring-2 ring-primary/50" : "hover:bg-card/60",
                  wh.status === "healthy" ? "border-l-emerald-500" :
                  wh.status === "at_risk" ? "border-l-yellow-500" : "border-l-red-500"
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="font-bold text-base truncate">{wh.store_id}</div>
                  <Badge
                    variant={wh.status === "healthy" ? "default" : wh.status === "at_risk" ? "secondary" : "destructive"}
                    className={cn(
                      "text-[10px] px-1.5 py-0",
                      wh.status === "healthy" && "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20",
                      wh.status === "at_risk" && "bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20",
                    )}
                  >
                    {wh.status === "healthy" ? "Healthy" : wh.status === "at_risk" ? "At Risk" : "Critical"}
                  </Badge>
                </div>
                <div className="mt-3 flex justify-between text-xs text-muted-foreground">
                  <span>{wh.total_skus} Materials</span>
                  <span>{wh.low_stock_count} Low Stock</span>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ── LEVEL 1: Syncing State (When DB records are loading or empty) ── */}
      {categories.length === 0 && !loading && (
        <Card className="border border-border/80 bg-card/30 p-12 text-center rounded-2xl shadow-sm">
          <div className="max-w-md mx-auto space-y-4">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
              <Database className="h-7 w-7" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">Database Connected</h2>
              <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                Loading SKU registry and category aggregations directly from the database.
              </p>
            </div>
            <div className="pt-2">
              <button
                type="button"
                onClick={fetchData}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <RotateCcw className="h-4 w-4" /> Refresh Database Records
              </button>
            </div>
          </div>
        </Card>
      )}

      {/* ── LEVEL 1: Category Grid (When dataset is uploaded) ── */}
      {!selectedCategory && categories.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              Category Overview ({categories.length})
            </h2>
            <span className="text-xs text-muted-foreground">Click any category card to drill down into SKU records</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {categories.map((cat) => {
              const Icon = getCategoryIcon(cat.category);
              const hasRisk = cat.atRiskCount > 0;
              return (
                <Card
                  key={cat.category}
                  onClick={() => setSelectedCategory(cat.category)}
                  className={cn(
                    "cursor-pointer hover:bg-card/90 transition-all duration-200 border-l-4 overflow-hidden relative group hover:shadow-md hover:-translate-y-0.5",
                    hasRisk
                      ? "border-l-red-500 shadow-[0_0_15px_rgba(239,68,68,0.08)]"
                      : "border-l-primary shadow-sm"
                  )}
                >
                  {hasRisk && <div className="absolute inset-0 bg-red-500/5 pointer-events-none" />}
                  <CardHeader className="pb-2 relative z-10">
                    <CardTitle className="text-base font-semibold flex items-center justify-between">
                      <span className="truncate">{cat.category}</span>
                      <div className="p-2 rounded-lg bg-primary/10 text-primary group-hover:scale-110 transition-transform">
                        <Icon className="h-4 w-4" />
                      </div>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 relative z-10 pt-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-muted-foreground">Total SKUs</span>
                      <span className="font-semibold text-foreground">{cat.skuCount}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-muted-foreground">Stockout Risk</span>
                      {hasRisk ? (
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                          {cat.atRiskCount} at risk
                        </Badge>
                      ) : (
                        <span className="text-emerald-500 font-medium">Optimal</span>
                      )}
                    </div>
                    <div className="flex justify-between items-center text-xs border-t pt-2 mt-2">
                      <span className="text-muted-foreground">Est. Value</span>
                      <span className="font-bold text-foreground">{formatCurrency(cat.totalValue)}</span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* ── LEVEL 2: Drill-down SKU Table & Manual Adjustment Form ── */}
      {selectedCategory && (
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-muted/20 p-3 rounded-xl border">
            <button
              type="button"
              onClick={() => {
                setSelectedCategory(null);
                setSearchTerm("");
              }}
              className="inline-flex items-center gap-2 text-xs font-semibold text-primary hover:underline"
            >
              <ArrowLeft className="h-4 w-4" /> Back to Categories
            </button>

            <div className="relative w-full sm:w-72">
              <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Filter by SKU, store, region…"
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-background border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
            {/* ── Table (3/4 width) ── */}
            <div className="lg:col-span-3">
              <Card className="shadow-sm overflow-hidden border">
                <CardHeader className="pb-3 border-b bg-card">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base font-semibold">{selectedCategory} SKU Records</CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Showing {filteredTransactions.length} dynamic stock records
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                    {filteredTransactions.length === 0 ? (
                      <div className="py-12 text-center text-muted-foreground text-sm">
                        No transactions found for this category or filter.
                      </div>
                    ) : (
                      <Table className="relative">
                        <TableHeader className="bg-muted/40 sticky top-0 z-30 shadow-sm">
                          <TableRow className="border-b">
                            <TableHead className="sticky left-0 bg-muted/95 z-30 pl-6 min-w-[120px]">Date</TableHead>
                            <TableHead className="sticky left-[120px] bg-muted/95 z-30 min-w-[100px]">Store</TableHead>
                            <TableHead className="sticky left-[220px] bg-muted/95 z-30 min-w-[130px] border-r">SKU</TableHead>
                            <TableHead className="min-w-[100px]">Region</TableHead>
                            <TableHead className="text-right min-w-[110px]">Inventory</TableHead>
                            <TableHead className="text-right min-w-[110px]">Reorder</TableHead>
                            <TableHead className="min-w-[180px]">Supplier</TableHead>
                            <TableHead className="text-right min-w-[100px]">Price</TableHead>
                            <TableHead className="text-right min-w-[90px]">Discount</TableHead>
                            <TableHead className="text-right min-w-[110px]">Competitor</TableHead>
                            <TableHead className="min-w-[110px]">Season</TableHead>
                            <TableHead className="min-w-[110px]">Weather</TableHead>
                            <TableHead className="text-center min-w-[90px]">Promo</TableHead>
                            <TableHead className="text-center min-w-[100px]">Anomaly</TableHead>
                            <TableHead className="min-w-[180px] pr-6">Reason</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredTransactions.map((tx, idx) => (
                            <TableRow key={tx.id ?? idx} className="hover:bg-muted/30 transition-colors">
                              <TableCell className="sticky left-0 bg-card z-20 pl-6 text-muted-foreground text-xs font-mono">
                                {formatDate(tx.date)}
                              </TableCell>
                              <TableCell className="sticky left-[120px] bg-card z-20 font-medium text-xs">
                                {tx.store_id}
                              </TableCell>
                              <TableCell className="sticky left-[220px] bg-card z-20 text-xs font-semibold border-r">
                                {tx.product_id}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">{tx.region || "—"}</TableCell>
                              <TableCell className={cn("text-right tabular-nums text-xs font-bold", tx.inventory_level < (tx.reorder_level ?? 50) ? "text-red-400" : "text-foreground")}>
                                {tx.inventory_level?.toLocaleString()}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                                {tx.reorder_level ?? "—"}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground truncate max-w-[180px]">
                                {tx.supplier_name || "—"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-xs font-medium">
                                {tx.price ? `$${Number(tx.price).toFixed(2)}` : "—"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                                {tx.discount ? `${(Number(tx.discount) * 100).toFixed(0)}%` : "0%"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                                {tx.competitor_pricing ? `$${Number(tx.competitor_pricing).toFixed(2)}` : "—"}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground capitalize">{tx.seasonality || "—"}</TableCell>
                              <TableCell className="text-xs text-muted-foreground capitalize">{tx.weather_condition || "—"}</TableCell>
                              <TableCell className="text-center">
                                {tx.holiday_promotion === true ? (
                                  <Check className="h-3.5 w-3.5 text-emerald-400 mx-auto" />
                                ) : (
                                  <X className="h-3.5 w-3.5 text-muted-foreground/30 mx-auto" />
                                )}
                              </TableCell>
                              <TableCell className="text-center">
                                {tx.is_anomaly ? (
                                  <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/20 text-[10px] gap-1 px-1.5 py-0 mx-auto">
                                    <AlertTriangle className="h-2.5 w-2.5" /> Yes
                                  </Badge>
                                ) : null}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground truncate max-w-[180px] pr-6">
                                {tx.anomaly_reason || (tx.is_anomaly ? "Depletion spike" : "—")}
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

            {/* ── Manual Adjustment Form (1/4 width) ── */}
            <div className="lg:col-span-1">
              <Card className="shadow-sm border border-t-4 border-t-primary">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Plus className="h-4 w-4 text-primary" />
                    Manual Stock Receipt
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">Log warehouse counts or emergency deliveries</p>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleAdjustStock} className="space-y-3.5">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-muted-foreground">Store / Site ID</label>
                      <input
                        type="text"
                        required
                        value={storeId}
                        onChange={(e) => setStoreId(e.target.value)}
                        className="w-full bg-background border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                        placeholder="e.g. S001"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-muted-foreground">Product ID / SKU</label>
                      <input
                        type="text"
                        required
                        value={productId}
                        onChange={(e) => setProductId(e.target.value)}
                        className="w-full bg-background border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                        placeholder="e.g. P0001 or SKU-001"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-muted-foreground">Counted Inventory Level</label>
                      <input
                        type="number"
                        required
                        value={qty}
                        onChange={(e) => setQty(e.target.value)}
                        className="w-full bg-background border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                        placeholder="e.g. 250"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold py-2.5 transition-all shadow-sm disabled:opacity-50"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {isSubmitting ? "Logging Adjustment..." : "Log Receipt"}
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
