"use client";

import React, { useRef, useState, useCallback } from "react";
import { useCountUp } from "@/lib/useCountUp";
import { LucideIcon, Sparkles } from "lucide-react";

interface HeroKpiCardProps {
  label: string;
  value: number;
  maxScore?: number;
  subtitle?: string;
  icon: LucideIcon;
  badgeText?: string;
}

export function HeroKpiCard({
  label,
  value,
  maxScore = 100,
  subtitle = "Dynamic fleet-wide aggregate score",
  icon: Icon,
  badgeText = "FLAGSHIP METRIC",
}: HeroKpiCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [transformStyle, setTransformStyle] = useState<string>(
    "rotateX(0deg) rotateY(0deg) translateZ(0px)"
  );
  const [isHovered, setIsHovered] = useState<boolean>(false);

  // Synchronized 1.2s reveal count-up
  const animatedValue = useCountUp(Math.round(value), 1200);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    if (!card) return;

    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    // Subtle 6.5 degree max clamp
    const rotateX = Math.max(Math.min(-((y - centerY) / centerY) * 6.5, 6.5), -6.5);
    const rotateY = Math.max(Math.min(((x - centerX) / centerX) * 6.5, 6.5), -6.5);

    setTransformStyle(`rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) translateZ(8px)`);
  }, []);

  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setTransformStyle("rotateX(0deg) rotateY(0deg) translateZ(0px)");
  };

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="hero-kpi-card relative rounded-xl cursor-default select-none group"
      style={{
        transform: transformStyle,
        transition: isHovered ? "transform 0.08s ease-out" : "transform 0.4s ease-out",
      }}
    >
      {/* Outer ambient glow gradient specifically highlighting the flagship card */}
      <div className="absolute -inset-0.5 bg-gradient-to-br from-[#FFB627]/40 via-transparent to-[#FF6B35]/20 rounded-xl blur-sm opacity-50 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

      {/* Main card body with glassmorphism + solar core gold border */}
      <div className="relative rounded-xl bg-[#14151F]/90 backdrop-blur-md border border-[#FFB627]/30 p-5 shadow-[0_12px_36px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,182,39,0.2)] overflow-hidden">
        {/* Subtle background solar core flare */}
        <div className="absolute -top-12 -right-12 w-32 h-32 bg-radial from-[#FFB627]/15 to-transparent rounded-full pointer-events-none blur-xl" />

        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold tracking-wider uppercase text-[#FFB627] bg-[#FFB627]/10 px-2 py-0.5 rounded border border-[#FFB627]/25">
              <Sparkles className="w-3 h-3 text-[#FFB627]" />
              {badgeText}
            </span>
          </div>
          <div className="p-2 rounded-lg bg-[#FFB627]/10 text-[#FFB627] border border-[#FFB627]/20 group-hover:scale-105 transition-transform">
            <Icon className="w-4 h-4 text-[#FFB627]" />
          </div>
        </div>

        <div className="text-xs font-medium text-[#8B87A0] mb-1 tracking-normal">
          {label}
        </div>

        <div className="flex items-baseline gap-1.5 my-1">
          <span className="text-4xl font-bold font-heading text-[#F5F1E8] tracking-tight tabular-nums drop-shadow-[0_2px_12px_rgba(255,182,39,0.25)]">
            {animatedValue}
          </span>
          <span className="text-sm font-normal text-[#8B87A0]">
            /{maxScore}
          </span>
        </div>

        <p className="text-[11px] text-[#8B87A0] mt-2 line-clamp-1">
          {subtitle}
        </p>

        {/* Dynamic risk status indicator bar */}
        <div className="mt-3.5 h-1.5 w-full bg-[#1C1E2B] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-1000 ease-out"
            style={{
              width: `${Math.min(100, Math.max(5, value))}%`,
              backgroundColor: value >= 60 ? "#F0455C" : value >= 30 ? "#FBBF24" : "#34D399",
            }}
          />
        </div>
      </div>
    </div>
  );
}
