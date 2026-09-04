"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { queryAgent } from "@/lib/api";
import { QueryResponse } from "@/types";
import { Card, CardContent } from "@/components/ui/card";
import { Send, RefreshCw, ChevronDown, ChevronUp, ExternalLink, Bot, User } from "lucide-react";
import { cn } from "@/lib/utils";

type MessageRole = "user" | "assistant";

interface Message {
  id: string;
  role: MessageRole;
  content: string;
  response?: QueryResponse;
  error?: boolean;
  loading?: boolean;
}

const CANNED_QUESTIONS = [
  "Which SKUs are at highest stockout risk?",
  "Are there any excess inventory risks this quarter?",
  "Why did we order more resin pellets this month?",
  "What is the current risk level for TechCircuits Ltd?"
];

// Typing indicator component
function TypingIndicator() {
  return (
    <div className="flex items-end gap-3">
      <div className="flex items-center justify-center size-8 rounded-full bg-primary/10 shrink-0">
        <Bot className="h-4 w-4 text-primary" />
      </div>
      <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:0ms]" />
        <span className="size-2 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:150ms]" />
        <span className="size-2 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:300ms]" />
      </div>
    </div>
  );
}

// Collapsible reasoning section
function ReasoningSection({ reasoning }: { reasoning: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 border border-border/60 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted/50 transition-colors"
      >
        <span>Show reasoning</span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <div className="px-3 py-2 text-xs text-muted-foreground bg-muted/30 border-t border-border/60 leading-relaxed">
          {reasoning}
        </div>
      )}
    </div>
  );
}

// Citation chip
function CitationChip({ source, snippet }: { source: string; snippet: string }) {
  const [hover, setHover] = useState(false);
  return (
    <div className="relative inline-block">
      <button
        type="button"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border border-border bg-card hover:bg-muted transition-colors"
      >
        <ExternalLink className="h-3 w-3 text-muted-foreground" />
        <span className="truncate max-w-[160px]">{source}</span>
      </button>
      {hover && (
        <div className="absolute bottom-full left-0 mb-1 z-20 w-64 p-2 rounded-md bg-popover border border-border text-xs text-popover-foreground shadow-lg">
          {snippet}
        </div>
      )}
    </div>
  );
}

// Single assistant message bubble
function AssistantBubble({ msg, onRetry }: { msg: Message; onRetry: (id: string, question: string) => void }) {
  if (msg.loading) return <TypingIndicator />;
  if (msg.error) {
    return (
      <div className="flex items-end gap-3">
        <div className="flex items-center justify-center size-8 rounded-full bg-destructive/10 shrink-0">
          <Bot className="h-4 w-4 text-destructive" />
        </div>
        <div className="bg-destructive/10 border border-destructive/30 rounded-2xl rounded-bl-sm px-4 py-3 max-w-lg">
          <p className="text-sm text-destructive font-medium">Something went wrong. Please try again.</p>
          <button
            type="button"
            onClick={() => onRetry(msg.id, msg.content)}
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-destructive hover:underline"
          >
            <RefreshCw className="h-3 w-3" /> Retry
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-end gap-3">
      <div className="flex items-center justify-center size-8 rounded-full bg-primary/10 shrink-0">
        <Bot className="h-4 w-4 text-primary" />
      </div>
      <div className="flex-1 max-w-2xl">
        <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-3">
          <p className="text-sm leading-relaxed">{msg.response?.answer}</p>
          {msg.response?.reasoning && msg.response.reasoning.length > 0 && (
            <ReasoningSection reasoning={msg.response.reasoning} />
          )}
        </div>
        {msg.response?.citations && msg.response.citations.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2 pl-1">
            {msg.response.citations.map((c, i) => (
              <CitationChip key={i} source={c.source} snippet={c.snippet} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatPageInner() {
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "",
      response: {
        answer: "Hello! I'm the ProcureAI Agent. Ask me anything about your inventory, suppliers, or purchase orders. You can also use the quick prompts below to get started.",
        reasoning: "",
        citations: [],
      },
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const autoAsked = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-ask from ?autoask= param (used by "Run Agent" demo button)
  useEffect(() => {
    const q = searchParams.get("autoask");
    if (q && !autoAsked.current) {
      autoAsked.current = true;
      // Small delay so the page mounts first
      setTimeout(() => sendMessage(decodeURIComponent(q)), 600);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const sendMessage = async (question: string, forceError = false) => {
    if (!question.trim() || isSubmitting) return;

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: question.trim(),
    };

    const loadingId = `loading-${Date.now()}`;
    const loadingMsg: Message = {
      id: loadingId,
      role: "assistant",
      content: question.trim(),
      loading: true,
    };

    setMessages((prev) => [...prev, userMsg, loadingMsg]);
    setInputValue("");
    setIsSubmitting(true);

    try {
      // Dev escape hatch: append ?fail=1 to URL to force error state
      const shouldFail =
        forceError ||
        (typeof window !== "undefined" &&
          new URLSearchParams(window.location.search).get("fail") === "1");
      if (shouldFail) throw new Error("Forced error for testing");

      const response = await queryAgent(question.trim());
      setMessages((prev) =>
        prev.map((m) =>
          m.id === loadingId ? { ...m, loading: false, response } : m
        )
      );
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === loadingId ? { ...m, loading: false, error: true } : m
        )
      );
    } finally {
      setIsSubmitting(false);
      inputRef.current?.focus();
    }
  };

  // Fix: filter by id, not content — avoids removing the user's bubble too
  const handleRetry = (errorMsgId: string, question: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== errorMsgId));
    sendMessage(question);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputValue);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] md:h-screen max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex-none py-4 px-1 border-b mb-2">
        <h1 className="text-2xl font-bold tracking-tight">Procurement Agent</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Ask questions about inventory, suppliers, and purchase orders
        </p>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto py-4 px-1 space-y-6">
        {messages.map((msg) =>
          msg.role === "user" ? (
            <div key={msg.id} className="flex items-end justify-end gap-3">
              <div className="bg-primary text-primary-foreground rounded-2xl rounded-br-sm px-4 py-3 max-w-lg">
                <p className="text-sm leading-relaxed">{msg.content}</p>
              </div>
              <div className="flex items-center justify-center size-8 rounded-full bg-muted shrink-0">
                <User className="h-4 w-4" />
              </div>
            </div>
          ) : (
            <AssistantBubble key={msg.id} msg={msg} onRetry={handleRetry} />
          )
        )}
        <div ref={bottomRef} />
      </div>

      {/* Quick prompts */}
      <div className="flex-none px-1 py-2">
        <p className="text-xs text-muted-foreground mb-2 font-medium">Suggested questions</p>
        <div className="flex flex-wrap gap-2">
          {CANNED_QUESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => sendMessage(q)}
              disabled={isSubmitting}
              className="text-xs px-3 py-1.5 rounded-full border border-border bg-card hover:bg-muted transition-colors disabled:opacity-50 text-left"
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* Input area */}
      <div className="flex-none px-1 pb-4 pt-2">
        <Card className="shadow-sm">
          <CardContent className="p-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                rows={1}
                placeholder="Ask about inventory, suppliers, purchase orders…"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isSubmitting}
                className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50 max-h-32 leading-relaxed py-1"
                style={{ fieldSizing: "content" } as React.CSSProperties}
              />
              <button
                type="button"
                onClick={() => sendMessage(inputValue)}
                disabled={isSubmitting || !inputValue.trim()}
                className={cn(
                  "shrink-0 inline-flex items-center justify-center size-8 rounded-lg transition-colors",
                  inputValue.trim() && !isSubmitting
                    ? "bg-primary text-primary-foreground hover:bg-primary/80"
                    : "bg-muted text-muted-foreground cursor-not-allowed"
                )}
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </CardContent>
        </Card>
        <p className="text-xs text-muted-foreground mt-1.5 text-center">
          Press <kbd className="px-1 py-0.5 rounded bg-muted text-xs font-mono">Enter</kbd> to send · <kbd className="px-1 py-0.5 rounded bg-muted text-xs font-mono">Shift+Enter</kbd> for new line
        </p>
      </div>
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense>
      <ChatPageInner />
    </Suspense>
  );
}
