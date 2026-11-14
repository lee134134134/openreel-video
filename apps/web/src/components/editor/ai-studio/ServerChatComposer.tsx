import { useState, type JSX, type KeyboardEvent } from "react";
import { Send, Square, X } from "@/icons/lucide-compat";
import { ToolcraftButton as Button, ToolcraftTextAreaControl } from "@openreel/ui";
import { useServerChatStore } from "../../../stores/server-chat-store";

export function ServerChatComposer(): JSX.Element {
  const [value, setValue] = useState("");
  const sending = useServerChatStore((state) => state.sending);
  const send = useServerChatStore((state) => state.send);
  const stop = useServerChatStore((state) => state.stop);
  const quote = useServerChatStore((state) => state.quote);
  const setQuote = useServerChatStore((state) => state.setQuote);
  const unavailable = useServerChatStore((state) => state.health?.ok === false);

  const submit = async () => {
    const text = value.trim();
    if ((!text && !quote) || sending || unavailable) return;
    setValue("");
    const message = quote && !text ? "请按我的后续要求优化这条成片。" : text;
    await send(message);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <div className="shrink-0 border-t border-border bg-bg-1 p-3">
      {quote && (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-accent/30 bg-accent-soft px-2.5 py-1.5" aria-label="已引用成片">
          <span className="min-w-0 flex-1 truncate text-[10px] text-accent">
            引用成片：{quote.title}
          </span>
          <button
            type="button"
            aria-label="移除引用"
            onClick={() => setQuote(null)}
            className="shrink-0 rounded text-accent hover:bg-accent/10"
          >
            <X size={12} aria-hidden />
          </button>
        </div>
      )}
      <ToolcraftTextAreaControl
        ariaLabel="描述想生成的视频"
        value={value}
        onChange={setValue}
        onKeyDown={onKeyDown}
        rows={3}
        isDisabled={unavailable}
        placeholder={quote ? "告诉 AI 怎么改这条成片：改文案、换场景、调时长…" : "描述主题、风格和分镜，Enter 发送，Shift+Enter 换行…"}
        inputClassName="max-h-36 min-h-20 resize-none text-[12px]"
      />
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[10px] text-fg-muted">{quote ? "修订方案确认后才会重新渲染" : "分镜确认后才会开始渲染"}</span>
        {sending ? (
          <Button label="停止" size="sm" variant="secondary" className="ml-auto" onClick={stop} icon={<Square size={12} aria-hidden />} />
        ) : (
          <Button label="发送" size="sm" variant="primary" className="ml-auto" isDisabled={!value.trim() || unavailable} onClick={() => void submit()} icon={<Send size={12} aria-hidden />} />
        )}
      </div>
    </div>
  );
}
