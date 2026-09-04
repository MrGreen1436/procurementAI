"use client";

import { useState, useRef } from "react";
import { Upload, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { uploadDataset } from "@/lib/api";

interface UploadCSVButtonProps {
  onUploadSuccess?: () => void;
  className?: string;
  variant?: "primary" | "outline" | "hero";
}

export function UploadCSVButton({ onUploadSuccess, className = "", variant = "primary" }: UploadCSVButtonProps) {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const toastId = toast.loading(`Uploading & processing ${file.name}...`);

    try {
      const res = await uploadDataset(file);
      if (res.success) {
        toast.success("Dataset Uploaded Successfully!", {
          id: toastId,
          description: "Inventory registry and supply chain state updated dynamically.",
          icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
          duration: 4000,
        });
        if (onUploadSuccess) {
          onUploadSuccess();
        } else {
          setTimeout(() => {
            window.location.reload();
          }, 1000);
        }
      } else {
        toast.error("Upload Failed", {
          id: toastId,
          description: res.message || "Failed to process dataset file.",
          duration: 5000,
        });
      }
    } catch (err: any) {
      toast.error("Upload Error", {
        id: toastId,
        description: err.message || "Could not connect to backend server.",
        duration: 5000,
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const getStyle = () => {
    if (variant === "outline") {
      return "inline-flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 hover:bg-primary/20 text-primary text-xs font-semibold px-3 py-2 transition-colors disabled:opacity-50 cursor-pointer shadow-sm";
    }
    if (variant === "hero") {
      return "inline-flex items-center justify-center gap-2.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-6 py-3.5 text-sm shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-all cursor-pointer disabled:opacity-50 active:scale-95";
    }
    return "inline-flex items-center gap-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold px-3.5 py-2 transition-colors disabled:opacity-50 cursor-pointer shadow-sm";
  };

  return (
    <>
      <input
        type="file"
        accept=".csv,.xlsx,.xls"
        className="hidden"
        ref={fileInputRef}
        onChange={handleFileChange}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className={`${getStyle()} ${className}`}
      >
        <Upload className="h-4 w-4" />
        {uploading ? "Uploading & Analyzing..." : "Upload Dataset"}
      </button>
    </>
  );
}
