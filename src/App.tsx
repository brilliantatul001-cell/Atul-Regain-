/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {useEffect, useRef, useState} from 'react';
import {Download, WifiOff, X} from 'lucide-react';
import {useOnlineStatus, usePWAInstall} from './hooks/usePWAInstall';
import {
  firebaseArenaBridge,
  type FirebaseArenaBridge,
} from './lib/firebaseArena';

const SPA_ASSET_PATH = '/assets/aistudio/Leave_It_v101_Laptop_Fixed_d7f9ca8a.html';

declare global {
  interface Window {
    LeaveItFirebase?: FirebaseArenaBridge;
  }
}

window.LeaveItFirebase = firebaseArenaBridge;

export default function App() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const {canInstall, isInstalled, isIOS, isStandalone, promptInstall} =
    usePWAInstall();
  const isOnline = useOnlineStatus();
  const [dismissedInstall, setDismissedInstall] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  useEffect(() => {
    window.LeaveItFirebase = firebaseArenaBridge;
    void firebaseArenaBridge.completeEmailLinkIfPresent().catch(() => {});
  }, []);

  useEffect(() => {
    const postInstallState = () => {
      const target = iframeRef.current?.contentWindow;
      if (!target) return;
      target.postMessage(
        {
          type: isInstalled
            ? 'leaveit-pwa-installed'
            : 'leaveit-pwa-install-available',
          canInstall,
        },
        window.location.origin,
      );
    };

    postInstallState();

    const handleMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin || !event.data) return;
      if (event.data.type === 'leaveit-iframe-ready') {
        postInstallState();
      } else if (event.data.type === 'leaveit-trigger-install') {
        if (canInstall) {
          await promptInstall();
        } else if (isIOS) {
          setShowIOSGuide(true);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [canInstall, isInstalled, isIOS, promptInstall]);

  const showFloatingInstall =
    !isStandalone && !isInstalled && !dismissedInstall && (canInstall || isIOS);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-[#0b0b0b]">
      {!isOnline && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-amber-500/95 px-3.5 py-1.5 text-xs font-semibold text-slate-950 shadow-lg backdrop-blur"
        >
          <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Offline mode active</span>
        </div>
      )}

      <iframe
        ref={iframeRef}
        src={SPA_ASSET_PATH}
        title="Leave It Timer"
        className="block h-full w-full border-0 bg-[#0b0b0b]"
        allow="fullscreen; autoplay; microphone; clipboard-write; wake-lock"
        onLoad={() => {
          iframeRef.current?.contentWindow?.postMessage(
            {
              type: isInstalled
                ? 'leaveit-pwa-installed'
                : 'leaveit-pwa-install-available',
              canInstall,
            },
            window.location.origin,
          );
        }}
      />

      {showFloatingInstall && (
        <div className="fixed bottom-24 right-4 z-40 flex items-center gap-1.5 rounded-full border border-white/15 bg-[#181c30]/95 p-1 pl-3 text-xs font-semibold text-white shadow-xl backdrop-blur">
          <button
            type="button"
            onClick={() => {
              if (canInstall) {
                void promptInstall();
              } else {
                setShowIOSGuide((v) => !v);
              }
            }}
            className="flex cursor-pointer items-center gap-1.5 py-1 pr-1 transition-colors hover:text-[#3ddc97]"
          >
            <Download className="h-3.5 w-3.5 text-[#3ddc97]" aria-hidden="true" />
            <span>Install App</span>
          </button>
          <button
            type="button"
            aria-label="Dismiss install prompt"
            onClick={() => setDismissedInstall(true)}
            className="cursor-pointer rounded-full p-1 text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {showIOSGuide && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Install on iOS"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
          onClick={() => setShowIOSGuide(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#181c30] p-5 text-sm text-slate-200 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-base font-bold text-white">Install Leave It Timer</h2>
              <button
                type="button"
                aria-label="Close install instructions"
                onClick={() => setShowIOSGuide(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <p className="leading-relaxed text-slate-300">
              Tap the <strong className="text-white">Share</strong> button in Safari, then choose{' '}
              <strong className="text-white">Add to Home Screen</strong> to use Leave It Timer offline like a native app.
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
