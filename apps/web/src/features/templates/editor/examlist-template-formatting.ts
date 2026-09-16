import { formatTemplateDataTagValue } from "../data-tag-formatting";
import type { DataTagDefinition } from "../../../shared/templates/template-editor-contracts";

export function formatProjectDataTagSampleValue(
  definitionOrKey?: DataTagDefinition | string,
  value?: unknown,
  formatValue?: string,
  explicitFormatType?: string,
): string {
  return formatTemplateDataTagValue(definitionOrKey, value, formatValue, explicitFormatType);
}
