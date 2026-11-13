import { Menu, type MenuItemConstructorOptions, type BrowserWindow } from "electron";

export interface MenuNode {
  label: string;
  accelerator?: string;
  role?: string;
  // When set, the item dispatches this id to the renderer (via onAction) instead
  // of using a native Electron role. Used for app-level actions (undo/redo/file).
  actionId?: string;
  submenu?: MenuNode[];
}

export function buildMenuTemplate(platform: string): MenuNode[] {
  const isMac = platform === "darwin";
  const template: MenuNode[] = [];
  if (isMac) {
    template.push({
      label: "OpenReel",
      submenu: [
        { label: "关于 OpenReel", role: "about" },
        { label: "设置…", accelerator: "Cmd+,", actionId: "settings" },
        { label: "退出", role: "quit", accelerator: "Cmd+Q" },
      ],
    });
  }
  template.push({
    label: "文件",
    submenu: [
      { label: "新建项目", accelerator: "CmdOrCtrl+N", actionId: "newProject" },
      { label: "打开…", accelerator: "CmdOrCtrl+O", actionId: "open" },
      { label: "导出…", accelerator: "CmdOrCtrl+E", actionId: "export" },
    ],
  });
  template.push({
    label: "编辑",
    submenu: [
      { label: "撤销", accelerator: "CmdOrCtrl+Z", actionId: "undo" },
      { label: "重做", accelerator: "Shift+CmdOrCtrl+Z", actionId: "redo" },
      { label: "剪切", role: "cut" },
      { label: "复制", role: "copy" },
      { label: "粘贴", role: "paste" },
      ...(!isMac
        ? [{ label: "设置…", accelerator: "Ctrl+,", actionId: "settings" }]
        : []),
    ],
  });
  template.push({
    label: "显示",
    submenu: [
      { label: "重新加载", role: "reload", accelerator: "CmdOrCtrl+R" },
      { label: "强制重新加载", role: "forceReload", accelerator: "Shift+CmdOrCtrl+R" },
      {
        label: "切换开发者工具",
        role: "toggleDevTools",
        accelerator: "Alt+CmdOrCtrl+I",
      },
      { label: "切换全屏", role: "togglefullscreen" },
    ],
  });
  template.push({
    label: "窗口",
    submenu: [
      { label: "最小化", role: "minimize" },
      { label: "关闭", role: "close" },
    ],
  });
  template.push({
    label: "帮助",
    submenu: [
      { label: "OpenReel 帮助" },
      { label: "开源许可证", actionId: "openLicenses" },
    ],
  });
  return template;
}

export function installApplicationMenu(platform: string, onAction: (id: string) => void): void {
  const toElectron = (node: MenuNode): MenuItemConstructorOptions => ({
    label: node.label,
    accelerator: node.accelerator,
    role: node.actionId
      ? undefined
      : (node.role as MenuItemConstructorOptions["role"]),
    submenu: node.submenu?.map(toElectron),
    click: node.actionId
      ? () => onAction(node.actionId as string)
      : node.role
        ? undefined
        : () => onAction(node.label),
  });
  const template = buildMenuTemplate(platform).map(toElectron);
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

export function sendMenuAction(win: BrowserWindow | null, id: string): void {
  if (win) win.webContents.send("openreel:menu:action", id);
}
