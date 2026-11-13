import { useState, type JSX, type KeyboardEvent } from "react";
import { Send, Square } from "@/icons/lucide-compat";
import { ToolcraftButton as Button, ToolcraftTextAreaControl } from "@openreel/ui";
import { useServerChatStore } from "../../../stores/server-chat-store";

export function ServerChatComposer(): JSX.Element {
  const [value, setValue] = useState("");
  const sending = useServerChatStore((state) => state.sending);
  const send = useServerChatStore((state) => state.send);
  const stop = useServerChatStore((state) => state.stop);
  const unavailable = useServerChatStore((state) => state.health?.ok === false);

  const submit = async () => {
    const text = value.trim();
    if (!text || sending || unavailable) return;
    setValue("");
    await send(text);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <div className="shrink-0 border-t border-border bg-bg-1 p-3">
      <ToolcraftTextAreaControl
        ariaLabel="描述想生成的视频"
        value={value}
        onChange={setValue}
        onKeyDown={onKeyDown}
        rows={3}
        isDisabled={unavailable}
        placeholder="描述主题、风格和分镜，Enter 发送，Shift+Enter 换行…"
        inputClassName="max-h-36 min-h-20 resize-none text-[12px]"
      />
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[10px] text-fg-muted">分镜确认后才会开始渲染</span>
        {sending ? (
          <Button label="停止" size="sm" variant="secondary" className="ml-auto" onClick={stop} icon={<Square size={12} aria-hidden />} />
        ) : (
          <Button label="发送" size="sm" variant="primary" className="ml-auto" isDisabled={!value.trim() || unavailable} onClick={() => void submit()} icon={<Send size={12} aria-hidden />} />
        )}
      </div>
    </div>
  );
}
