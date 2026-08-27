import { formatDataTagSampleValue } from "examlist-template-editor/core";
import type { DataTagDefinition } from "../../../shared/templates/template-editor-contracts";

export function formatProjectDataTagSampleValue(
  definitionOrKey?: DataTagDefinition | string,
  value?: unknown,
  formatValue?: string,
  explicitFormatType?: string,
): string {
  return formatDataTagSampleValue(definitionOrKey, value, formatValue, explicitFormatType);
}
