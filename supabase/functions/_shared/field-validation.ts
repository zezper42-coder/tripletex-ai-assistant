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

export function validateProductFields(fields: Record<string, unknown>): ValidationError[] {
  return [
    ...validateRequired(fields, ["name"]),
  ];
}

export function validateProjectFields(fields: Record<string, unknown>): ValidationError[] {
  return [
    ...validateRequired(fields, ["name"]),
  ];
}

export function validateTravelExpenseDeleteFields(fields: Record<string, unknown>): ValidationError[] {
  const hasId = fields.id !== undefined;
  const hasEmployee = fields.employeeName !== undefined;
  const hasDate = fields.date !== undefined;
  const hasAmount = fields.amount !== undefined;
  const hasDescription = fields.description !== undefined;

  if (!hasId && !hasEmployee && !hasDate && !hasAmount && !hasDescription) {
    return [{ field: "identifiers", message: "At least one identifier required (id, employee, date, amount, or description)" }];
  }
  return [];
}

export function validateCreditNoteFields(fields: Record<string, unknown>): ValidationError[] {
  const hasInvoiceId = fields.invoiceId !== undefined || fields.invoice_id !== undefined;
  const hasInvoiceNumber = fields.invoiceNumber !== undefined || fields.invoice_number !== undefined;
  const hasCustomerName = fields.customerName !== undefined || fields.customer_name !== undefined;

  if (!hasInvoiceId && !hasInvoiceNumber && !hasCustomerName) {
    return [{ field: "invoiceReference", message: "At least one invoice reference required (invoiceId, invoiceNumber, or customerName)" }];
  }

  if (fields.amount !== undefined) {
    const amt = Number(fields.amount);
    if (isNaN(amt) || amt <= 0) {
      return [{ field: "amount", message: `Amount must be positive: ${fields.amount}` }];
    }
  }

  return [];
}

/**
 * Retry helper for 422 Validation Errors from Tripletex.
 * Parses validationMessages, strips problematic fields, retries once.
 * Returns the retry response or null if no retry was possible.
 */
export function extractValidationFields(responseData: unknown): string[] {
  if (!responseData || typeof responseData !== "object") return [];
  const data = responseData as Record<string, unknown>;
  const messages = data.validationMessages as Array<{ field?: string; message?: string }> | undefined;
  if (!Array.isArray(messages)) return [];
  return messages
    .map((m) => m.field)
    .filter((f): f is string => !!f)
    .map((f) => f.replace(/^[^.]*\./, "")); // strip prefix like "Employee."
}

export function stripFields(body: Record<string, unknown>, fieldsToRemove: string[]): Record<string, unknown> {
  const cleaned = { ...body };
  for (const f of fieldsToRemove) {
    delete cleaned[f];
  }
  return cleaned;
}
