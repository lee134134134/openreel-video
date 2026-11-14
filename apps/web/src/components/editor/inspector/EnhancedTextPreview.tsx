import React from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextAreaControl } from "@openreel/ui";
import { Sparkles } from "@/icons/lucide-compat";

interface EnhancedTextPreviewProps {
  enhancedPreview: string;
  onUpdate: (text: string) => void;
  onDiscard: () => void;
}

export const EnhancedTextPreview: React.FC<EnhancedTextPreviewProps> = ({
  enhancedPreview,
  onUpdate,
  onDiscard,
}) => {
  return (
    <Card
      variant="muted"
      padding={2}
      className="space-y-1.5 border border-amber-500/20 bg-amber-500/5"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Sparkles size={9} className="text-amber-400" />
          <Text type="supporting" className="text-[9px] font-medium text-amber-400">
            增强 - 在下方编辑然后点击生成
          </Text>
        </div>
        <Button
          label="放弃"
          variant="ghost"
          size="sm"
          onClick={onDiscard}
          className="text-[9px] text-fg-3 hover:text-red-400 transition-colors"
        />
      </div>
      <ToolcraftTextAreaControl
        label="增强预览"
        isLabelHidden
        value={enhancedPreview}
        onChange={onUpdate}
        width="100%"
        inputClassName="text-[10px]"
      />
    </Card>
  );
};
