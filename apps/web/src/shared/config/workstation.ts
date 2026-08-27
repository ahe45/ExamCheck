const configuredWorkstationCode = String(import.meta.env.VITE_WORKSTATION_CODE || "").trim();

export const WORKSTATION_CODE = configuredWorkstationCode || "WS-DEV-001";
