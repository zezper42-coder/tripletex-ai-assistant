// Field validation utilities — fail early before Tripletex API calls

export interface ValidationError {
  field: string;
  message: string;
}

const EMAIL_RE = /^[\w.+-]+@[\w.-]+\.\w{2,}$/i;
const PHONE_RE = /^\+?[\d\s()-]{6,20}$/;

export function validateRequired(
  fields: Record<string, unknown>,
  required: string[]
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const field of required) {
    const val = fields[field];
    if (val === undefined || val === null || (typeof val === "string" && val.trim() === "")) {
      errors.push({ field, message: `Missing required field: ${field}` });
    }
  }
  return errors;
}

export function validateEmail(email: unknown): ValidationError[] {
  if (email === undefined || email === null) return [];
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    return [{ field: "email", message: `Invalid email format: ${email}` }];
  }
  return [];
}

export function validatePhone(phone: unknown): ValidationError[] {
  if (phone === undefined || phone === null) return [];
  if (typeof phone !== "string" || !PHONE_RE.test(phone.trim())) {
    return [{ field: "phone", message: `Invalid phone format: ${phone}` }];
  }
  return [];
}

export function validateCustomerFields(fields: Record<string, unknown>): ValidationError[] {
  return [
    ...validateRequired(fields, ["name"]),
    ...validateEmail(fields.email),
    ...validatePhone(fields.phoneNumber || fields.phone),
  ];
}

export function validateEmployeeFields(fields: Record<string, unknown>): ValidationError[] {
  return [
    ...validateRequired(fields, ["firstName", "lastName"]),
    ...validateEmail(fields.email),
    ...validatePhone(fields.phoneNumberMobile || fields.phone),
  ];
}
