// Resource-specific Tripletex API schemas and endpoint mappings

export interface ResourceSchema {
  endpoint: string;
  requiredFields: string[];
  optionalFields: string[];
  buildBody: (fields: Record<string, unknown>) => Record<string, unknown>;
  verifyEndpoint?: (id: number | string) => string;
}

function s(val: unknown): string { return String(val); }

function optField(fields: Record<string, unknown>, key: string, transform?: (v: unknown) => unknown): Record<string, unknown> {
  if (fields[key] == null) return {};
  const val = transform ? transform(fields[key]) : fields[key];
  return { [key]: val };
}

function optRef(fields: Record<string, unknown>, key: string, refKey: string): Record<string, unknown> {
  if (fields[key] == null) return {};
  return { [refKey]: { id: fields[key] } };
}

export const RESOURCE_SCHEMAS: Record<string, ResourceSchema> = {
  customer: {
    endpoint: "/v2/customer",
    requiredFields: ["name"],
    optionalFields: ["email", "phoneNumber", "organizationNumber", "isCustomer", "isSupplier", "postalAddress", "physicalAddress", "invoiceEmail"],
    buildBody: (fields) => ({
      name: fields.name,
      ...optField(fields, "email"),
      ...optField(fields, "phoneNumber"),
      ...optField(fields, "organizationNumber", s),
      ...optField(fields, "invoiceEmail"),
      isCustomer: fields.isCustomer ?? true,
      isSupplier: fields.isSupplier ?? false,
    }),
    verifyEndpoint: (id) => `/v2/customer/${id}`,
  },

  employee: {
    endpoint: "/v2/employee",
    requiredFields: ["firstName", "lastName"],
    optionalFields: ["email", "phoneNumberMobile", "dateOfBirth", "employmentDate", "department", "jobTitle"],
    buildBody: (fields) => ({
      firstName: fields.firstName,
      lastName: fields.lastName,
      ...optField(fields, "email"),
      ...optField(fields, "phoneNumberMobile"),
      ...optField(fields, "dateOfBirth"),
      ...optField(fields, "employmentDate"),
    }),
    verifyEndpoint: (id) => `/v2/employee/${id}`,
  },

  product: {
    endpoint: "/v2/product",
    requiredFields: ["name"],
    optionalFields: ["number", "costExcludingVatCurrency", "priceExcludingVatCurrency", "priceIncludingVatCurrency", "isInactive", "vatType", "productUnit"],
    buildBody: (fields) => ({
      name: fields.name,
      ...optField(fields, "number"),
      ...optField(fields, "priceExcludingVatCurrency"),
      ...optField(fields, "priceIncludingVatCurrency"),
      ...optField(fields, "costExcludingVatCurrency"),
    }),
    verifyEndpoint: (id) => `/v2/product/${id}`,
  },

  invoice: {
    endpoint: "/v2/invoice",
    requiredFields: ["customerId", "invoiceDate", "invoiceDueDate"],
    optionalFields: ["orderLines", "orders", "comment", "ourContact", "yourContact"],
    buildBody: (fields) => ({
      customer: { id: fields.customerId },
      invoiceDate: fields.invoiceDate,
      invoiceDueDate: fields.invoiceDueDate,
      ...optField(fields, "orderLines", (v) => v),
      ...optField(fields, "orders"),
      ...optField(fields, "comment"),
    }),
    verifyEndpoint: (id) => `/v2/invoice/${id}`,
  },

  project: {
    endpoint: "/v2/project",
    requiredFields: ["name", "projectManagerId"],
    optionalFields: ["number", "startDate", "endDate", "customerId", "isClosed", "projectCategory", "description"],
    buildBody: (fields) => ({
      name: fields.name,
      projectManager: { id: fields.projectManagerId },
      ...optField(fields, "number", s),
      ...optField(fields, "startDate"),
      ...optField(fields, "endDate"),
      ...optRef(fields, "customerId", "customer"),
      ...optField(fields, "description"),
    }),
    verifyEndpoint: (id) => `/v2/project/${id}`,
  },

  travelExpense: {
    endpoint: "/v2/travelExpense",
    requiredFields: ["employeeId", "title"],
    optionalFields: ["travelDetails", "perDiemCompensations", "mileageAllowances", "costs", "departureDate", "returnDate"],
    buildBody: (fields) => ({
      employee: { id: fields.employeeId },
      title: fields.title,
      ...optField(fields, "departureDate"),
      ...optField(fields, "returnDate"),
    }),
    verifyEndpoint: (id) => `/v2/travelExpense/${id}`,
  },

  department: {
    endpoint: "/v2/department",
    requiredFields: ["name"],
    optionalFields: ["departmentNumber", "departmentManager"],
    buildBody: (fields) => ({
      name: fields.name,
      ...optField(fields, "departmentNumber", s),
      ...optRef(fields, "departmentManager", "departmentManager"),
    }),
    verifyEndpoint: (id) => `/v2/department/${id}`,
  },

  payment: {
    endpoint: "/v2/payment",
    requiredFields: ["invoiceId", "amount", "paymentDate"],
    optionalFields: ["paymentType"],
    buildBody: (fields) => ({
      ...optRef(fields, "invoiceId", "voucher"),
      amount: fields.amount,
      paymentDate: fields.paymentDate,
    }),
    verifyEndpoint: (id) => `/v2/payment/${id}`,
  },

  creditNote: {
    endpoint: "/v2/invoice",
    requiredFields: ["invoiceId"],
    optionalFields: ["comment"],
    buildBody: (fields) => ({
      invoiceId: fields.invoiceId,
      ...optField(fields, "comment"),
    }),
  },

  voucher: {
    endpoint: "/v2/ledger/voucher",
    requiredFields: ["date", "description"],
    optionalFields: ["postings"],
    buildBody: (fields) => ({
      date: fields.date,
      description: fields.description,
      ...optField(fields, "postings"),
    }),
    verifyEndpoint: (id) => `/v2/ledger/voucher/${id}`,
  },

  contact: {
    endpoint: "/v2/contact",
    requiredFields: ["firstName", "lastName"],
    optionalFields: ["email", "phoneNumber", "customerId"],
    buildBody: (fields) => ({
      firstName: fields.firstName,
      lastName: fields.lastName,
      ...optField(fields, "email"),
      ...optRef(fields, "customerId", "customer"),
    }),
    verifyEndpoint: (id) => `/v2/contact/${id}`,
  },

  order: {
    endpoint: "/v2/order",
    requiredFields: ["customerId", "deliveryDate"],
    optionalFields: ["orderLines", "orderDate"],
    buildBody: (fields) => ({
      customer: { id: fields.customerId },
      deliveryDate: fields.deliveryDate,
      ...optField(fields, "orderDate"),
      ...optField(fields, "orderLines"),
    }),
    verifyEndpoint: (id) => `/v2/order/${id}`,
  },

  activity: {
    endpoint: "/v2/activity",
    requiredFields: ["name"],
    optionalFields: ["number", "isProjectActivity", "isGeneral"],
    buildBody: (fields) => ({
      name: fields.name,
      ...optField(fields, "number"),
    }),
    verifyEndpoint: (id) => `/v2/activity/${id}`,
  },
};