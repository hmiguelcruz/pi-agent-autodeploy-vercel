"use client";

import { useChat } from "ai/react";
import { useState, useRef, useEffect } from "react";
import styles from "./Chat.module.css";

export default function Chat() {
  const [guardrailError, setGuardrailError] = useState<string | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: "/api/chat",
    onResponse: async (response) => {
      if (!response.ok) {
        let errorMsg = `Error: ${response.status}`;
        try {
          const clone = response.clone();
          const data = await clone.json();
          errorMsg = data.error || errorMsg;
        } catch {
          try {
            const text = await response.text();
            errorMsg = text || errorMsg;
          } catch {
            errorMsg = `Request failed with status ${response.status}`;
          }
        }
        setGuardrailError(errorMsg);
      } else {
        setGuardrailError(null);
      }
    },
    onError: (err) => {
      if (!guardrailError) {
        setGuardrailError(err.message || "An unexpected safety or network error occurred.");
      }
    },
  });

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() && !isLoading) {
        setGuardrailError(null);
        formRef.current?.requestSubmit();
      }
    }
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    setGuardrailError(null);
    handleSubmit(e);
  };

  const formatMessageContent = (content: string) => {
    const parts = content.split(/(```[\s\S]*?```)/g);
    return parts.map((part, index) => {
      const partKey = `part-${index}-${part.slice(0, 10)}`;
      if (part.startsWith("```") && part.endsWith("```")) {
        const match = part.match(/```(\w*)\n([\s\S]*?)```/);
        const language = match ? match[1] : "";
        const code = match ? match[2] : part.slice(3, -3);
        return (
          <div key={partKey} className={styles.codeContainer}>
            {language && <div className={styles.codeLanguage}>{language}</div>}
            <pre className={styles.pre}>
              <code className={styles.code}>{code.trim()}</code>
            </pre>
          </div>
        );
      } else {
        const inlineParts = part.split(/(`[^`\n]+`)/g);
        return (
          <span key={partKey} className={styles.textSpan}>
            {inlineParts.map((inlinePart, subIndex) => {
              const inlineKey = `inline-${subIndex}-${inlinePart.slice(0, 10)}`;
              if (inlinePart.startsWith("`") && inlinePart.endsWith("`")) {
                return (
                  <code key={inlineKey} className={styles.inlineCode}>
                    {inlinePart.slice(1, -1)}
                  </code>
                );
              }
              return inlinePart;
            })}
          </span>
        );
      }
    });
  };

  return (
    <div className={styles.container}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.logo}>
          π <span className={styles.logoSub}>agent</span>
        </div>
        <div className={styles.badge}>
          <span className={styles.badgeDot}></span>
          guardrails on
        </div>
      </header>

      {/* Messages area */}
      <div className={styles.messages} ref={messagesContainerRef}>
        {messages.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.welcomeTitle}>Welcome to π agent</p>
            <p className={styles.welcomeSub}>
              A secure, streaming AI coding assistant. Ask me anything, or try testing safety rules.
            </p>
          </div>
        ) : (
          messages.map((m, idx) => {
            const isUser = m.role === "user";
            const isLast = idx === messages.length - 1;
            return (
              <div key={m.id} className={styles.messageRow}>
                <div className={styles.meta}>
                  <span className={isUser ? styles.roleUser : styles.roleBot}>
                    {isUser ? "you" : "π"}
                  </span>
                </div>
                <div className={styles.bubble}>
                  {formatMessageContent(m.content)}
                  {isLoading && isLast && !isUser && (
                    <span className={styles.cursor}>▋</span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Sticky footer input area */}
      <footer className={styles.footer}>
        <form ref={formRef} onSubmit={onSubmit} className={styles.form}>
          {guardrailError && (
            <div className={styles.errorBox}>
              <span className={styles.errorIcon}>⚠️</span>
              <span className={styles.errorText}>{guardrailError}</span>
            </div>
          )}
          <div className={styles.inputContainer}>
            <textarea
              className={styles.textarea}
              placeholder={isLoading ? "Streaming response..." : "Ask π agent a question..."}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              rows={1}
            />
            <button
              type="submit"
              className={styles.sendButton}
              disabled={isLoading || !input.trim()}
            >
              Send
            </button>
          </div>
        </form>
      </footer>
    </div>
  );
}
