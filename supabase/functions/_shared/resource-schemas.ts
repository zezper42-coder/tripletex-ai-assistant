// Resource-specific Tripletex API schemas and endpoint mappings
// Each resource defines: endpoint, required fields, optional fields, and body builder

export interface ResourceSchema {
  endpoint: string;
  requiredFields: string[];
  optionalFields: string[];
  buildBody: (fields: Record<string, unknown>) => Record<string, unknown>;
  verifyEndpoint?: (id: number | string) => string;
}

export const RESOURCE_SCHEMAS: Record<string, ResourceSchema> = {
  customer: {
    endpoint: "/v2/customer",
    requiredFields: ["name"],
    optionalFields: [
      "email", "phoneNumber", "organizationNumber", "isCustomer", "isSupplier",
      "postalAddress", "physicalAddress", "invoiceEmail",
    ],
    buildBody: (fields) => ({
      name: fields.name,
      ...(fields.email && { email: fields.email }),
      ...(fields.phoneNumber && { phoneNumber: fields.phoneNumber }),
      ...(fields.organizationNumber && { organizationNumber: String(fields.organizationNumber) }),
      ...(fields.invoiceEmail && { invoiceEmail: fields.invoiceEmail }),
      isCustomer: fields.isCustomer ?? true,
      isSupplier: fields.isSupplier ?? false,
    }),
    verifyEndpoint: (id) => `/v2/customer/${id}`,
  },

  employee: {
    endpoint: "/v2/employee",
    requiredFields: ["firstName", "lastName"],
    optionalFields: [
      "email", "phoneNumberMobile", "dateOfBirth", "employmentDate",
      "department", "jobTitle",
    ],
    buildBody: (fields) => ({
      firstName: fields.firstName,
      lastName: fields.lastName,
      ...(fields.email && { email: fields.email }),
      ...(fields.phoneNumberMobile && { phoneNumberMobile: fields.phoneNumberMobile }),
      ...(fields.dateOfBirth && { dateOfBirth: fields.dateOfBirth }),
      ...(fields.employmentDate && { employmentDate: fields.employmentDate }),
    }),
    verifyEndpoint: (id) => `/v2/employee/${id}`,
  },

  product: {
    endpoint: "/v2/product",
    requiredFields: ["name"],
    optionalFields: [
      "number", "costExcludingVatCurrency", "priceExcludingVatCurrency",
      "priceIncludingVatCurrency", "isInactive", "vatType", "productUnit",
    ],
    buildBody: (fields) => ({
      name: fields.name,
      ...(fields.number && { number: fields.number }),
      ...(fields.priceExcludingVatCurrency && { priceExcludingVatCurrency: fields.priceExcludingVatCurrency }),
      ...(fields.priceIncludingVatCurrency && { priceIncludingVatCurrency: fields.priceIncludingVatCurrency }),
      ...(fields.costExcludingVatCurrency && { costExcludingVatCurrency: fields.costExcludingVatCurrency }),
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
      ...(fields.orderLines && { lines: fields.orderLines }),
      ...(fields.orders && { orders: fields.orders }),
      ...(fields.comment && { comment: fields.comment }),
    }),
    verifyEndpoint: (id) => `/v2/invoice/${id}`,
  },

  project: {
    endpoint: "/v2/project",
    requiredFields: ["name", "projectManagerId"],
    optionalFields: [
      "number", "startDate", "endDate", "customerId", "isClosed",
      "projectCategory", "description",
    ],
    buildBody: (fields) => ({
      name: fields.name,
      projectManager: { id: fields.projectManagerId },
      ...(fields.number && { number: String(fields.number) }),
      ...(fields.startDate && { startDate: fields.startDate }),
      ...(fields.endDate && { endDate: fields.endDate }),
      ...(fields.customerId && { customer: { id: fields.customerId } }),
      ...(fields.description && { description: fields.description }),
    }),
    verifyEndpoint: (id) => `/v2/project/${id}`,
  },

  travelExpense: {
    endpoint: "/v2/travelExpense",
    requiredFields: ["employeeId", "title"],
    optionalFields: [
      "travelDetails", "perDiemCompensations", "mileageAllowances",
      "costs", "departureDate", "returnDate",
    ],
    buildBody: (fields) => ({
      employee: { id: fields.employeeId },
      title: fields.title,
      ...(fields.departureDate && { departureDate: fields.departureDate }),
      ...(fields.returnDate && { returnDate: fields.returnDate }),
    }),
    verifyEndpoint: (id) => `/v2/travelExpense/${id}`,
  },

  department: {
    endpoint: "/v2/department",
    requiredFields: ["name"],
    optionalFields: ["departmentNumber", "departmentManager"],
    buildBody: (fields) => ({
      name: fields.name,
      ...(fields.departmentNumber && { departmentNumber: String(fields.departmentNumber) }),
      ...(fields.departmentManager && { departmentManager: { id: fields.departmentManager } }),
    }),
    verifyEndpoint: (id) => `/v2/department/${id}`,
  },

  // TODO: payment executor
  payment: {
    endpoint: "/v2/payment",
    requiredFields: ["invoiceId", "amount", "paymentDate"],
    optionalFields: ["paymentType"],
    buildBody: (fields) => ({
      ...(fields.invoiceId && { voucher: { id: fields.invoiceId } }),
      amount: fields.amount,
      paymentDate: fields.paymentDate,
    }),
    verifyEndpoint: (id) => `/v2/payment/${id}`,
  },

  // TODO: creditNote executor — uses invoice endpoint with :createCreditNote
  creditNote: {
    endpoint: "/v2/invoice",
    requiredFields: ["invoiceId"],
    optionalFields: ["comment"],
    buildBody: (fields) => ({
      invoiceId: fields.invoiceId,
      ...(fields.comment && { comment: fields.comment }),
    }),
  },

  // TODO: voucher executor
  voucher: {
    endpoint: "/v2/ledger/voucher",
    requiredFields: ["date", "description"],
    optionalFields: ["postings"],
    buildBody: (fields) => ({
      date: fields.date,
      description: fields.description,
      ...(fields.postings && { postings: fields.postings }),
    }),
    verifyEndpoint: (id) => `/v2/ledger/voucher/${id}`,
  },

  // TODO: contact executor
  contact: {
    endpoint: "/v2/contact",
    requiredFields: ["firstName", "lastName"],
    optionalFields: ["email", "phoneNumber", "customerId"],
    buildBody: (fields) => ({
      firstName: fields.firstName,
      lastName: fields.lastName,
      ...(fields.email && { email: fields.email }),
      ...(fields.customerId && { customer: { id: fields.customerId } }),
    }),
    verifyEndpoint: (id) => `/v2/contact/${id}`,
  },

  // TODO: order executor
  order: {
    endpoint: "/v2/order",
    requiredFields: ["customerId", "deliveryDate"],
    optionalFields: ["orderLines", "orderDate"],
    buildBody: (fields) => ({
      customer: { id: fields.customerId },
      deliveryDate: fields.deliveryDate,
      ...(fields.orderDate && { orderDate: fields.orderDate }),
      ...(fields.orderLines && { orderLines: fields.orderLines }),
    }),
    verifyEndpoint: (id) => `/v2/order/${id}`,
  },

  // TODO: activity executor
  activity: {
    endpoint: "/v2/activity",
    requiredFields: ["name"],
    optionalFields: ["number", "isProjectActivity", "isGeneral"],
    buildBody: (fields) => ({
      name: fields.name,
      ...(fields.number && { number: fields.number }),
    }),
    verifyEndpoint: (id) => `/v2/activity/${id}`,
  },
};
