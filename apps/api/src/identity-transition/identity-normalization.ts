export interface PersonalIdentityInput {
  examineeNo: string;
  name: string;
  birthDate: string;
}

export function normalizeIdentityText(value: string): string {
  return value.normalize("NFKC").trim();
}

export function normalizeExamineeNumber(value: string): string {
  // Examinee numbers are identifiers, not numbers. NFKC and trim are safe for
  // diagnostics, but leading zeroes must remain significant.
  return normalizeIdentityText(value);
}

export function canonicalPersonalIdentity(input: PersonalIdentityInput): string {
  return JSON.stringify([
    normalizeExamineeNumber(input.examineeNo),
    normalizeIdentityText(input.name),
    normalizeIdentityText(input.birthDate),
  ]);
}
