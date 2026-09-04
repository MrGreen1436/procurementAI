import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Sidebar } from "@/components/sidebar";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "ProcureAI — Supply Chain Intelligence & Risk Control Room",
  description: "Real-time supply chain forecasting, predictive supplier risk intelligence, and autonomous procurement decision engine.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="antialiased min-h-screen flex flex-col md:flex-row bg-[#0A0B10] text-[#F5F1E8]">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          forcedTheme="dark"
          disableTransitionOnChange
        >
          <Sidebar />
          <main className="flex-1 overflow-auto bg-[#0A0B10] p-4 md:p-8">
            {children}
          </main>
          <Toaster richColors position="top-right" theme="dark" />
        </ThemeProvider>
      </body>
    </html>
  );
}
