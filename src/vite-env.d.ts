/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

export {}

declare global {
  interface Window {
    costorecetasElectron?: {
      saveExportFile: (
        folderPath: string,
        fileName: string,
        contents: string,
      ) => Promise<{ ok: boolean; path?: string; error?: string }>
      pickExportFolder: () => Promise<string | null>
    }
  }
}

