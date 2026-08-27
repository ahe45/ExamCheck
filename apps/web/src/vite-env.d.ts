/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_PRINTER_MODE?: import("./features/printer/printer.types").PrinterMode;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
