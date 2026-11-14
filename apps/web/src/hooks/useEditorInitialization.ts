import { useCallback, useEffect, useState } from "react";
import { useEngineStore } from "../stores/engine-store";
import { useProjectStore } from "../stores/project-store";
import {
  initializePlaybackBridge,
  disposePlaybackBridge,
} from "../bridges/playback-bridge";
import {
  initializeMediaBridge,
  disposeMediaBridge,
} from "../bridges/media-bridge";
import {
  initializeRenderBridge,
  disposeRenderBridge,
} from "../bridges/render-bridge";
import {
  initializeEffectsBridge,
  disposeEffectsBridge,
} from "../bridges/effects-bridge";
import {
  initializeTransitionBridge,
  disposeTransitionBridge,
} from "../bridges/transition-bridge";

/**
 * Engine and bridge initialization hook
 * Ensures all engines and bridges are fully initialized before rendering editor
 */
export const useEditorInitialization = () => {
  const initialize = useEngineStore((state) => state.initialize);
  const initialized = useEngineStore((state) => state.initialized);
  const initializing = useEngineStore((state) => state.initializing);
  const initError = useEngineStore((state) => state.initError);
  const [bridgesReady, setBridgesReady] = useState(false);
  const [initStatus, setInitStatus] = useState("正在启动…");
  const [localError, setLocalError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setLocalError(null);
    setBridgesReady(false);
    setAttempt((previous) => previous + 1);
  }, []);

  useEffect(() => {
    let isMounted = true;
    let cancelWait: (() => void) | undefined;

    const initAll = async () => {
      try {
        const currentState = useEngineStore.getState();
        if (!currentState.initialized && !currentState.initializing) {
          setInitStatus("正在初始化视频引擎…");
          await initialize();
        } else if (currentState.initializing) {
          await new Promise<void>((resolve) => {
            const unsubscribe = useEngineStore.subscribe((state) => {
              if (state.initialized || state.initError) {
                unsubscribe();
                cancelWait = undefined;
                resolve();
              }
            });
            cancelWait = () => {
              unsubscribe();
              resolve();
            };
          });
        }

        if (!isMounted) return;

        const engineState = useEngineStore.getState();
        if (!engineState.initialized) {
          throw new Error(
            engineState.initError || "引擎初始化失败",
          );
        }

        setInitStatus("正在初始化媒体桥接…");
        await initializeMediaBridge();
        if (!isMounted) return;

        setInitStatus("正在初始化播放桥接…");
        await initializePlaybackBridge();
        if (!isMounted) return;

        setInitStatus("正在初始化渲染桥接…");
        await initializeRenderBridge();
        if (!isMounted) return;

        setInitStatus("正在初始化效果桥接…");
        const projectState = useProjectStore.getState();
        const { width, height } = projectState.project.settings;
        try {
          await initializeEffectsBridge(width, height);
        } catch (effectsError) {
          console.error(
            "[EditorInterface] EffectsBridge initialization failed:",
            effectsError,
          );
        }
        if (!isMounted) return;

        setInitStatus("正在初始化转场桥接…");
        try {
          initializeTransitionBridge(width, height);
        } catch (transitionError) {
          console.error(
            "[EditorInterface] TransitionBridge initialization failed:",
            transitionError,
          );
        }
        if (!isMounted) return;

        setBridgesReady(true);
      } catch (error) {
        console.error("Failed to initialize engines/bridges:", error);
        if (isMounted) {
          setLocalError(
            error instanceof Error ? error.message : "未知错误",
          );
          setInitStatus(
            `错误：${error instanceof Error ? error.message : "未知错误"}`,
          );
        }
      }
    };

    initAll();

    return () => {
      isMounted = false;
      cancelWait?.();
      disposePlaybackBridge();
      disposeMediaBridge();
      disposeRenderBridge();
      disposeEffectsBridge();
      disposeTransitionBridge();
    };
  }, [initialize, attempt]);

  return {
    initialized: initialized && bridgesReady,
    initializing: initializing || (!bridgesReady && initialized),
    initError: initError || localError,
    initStatus,
    retry,
  };
};
