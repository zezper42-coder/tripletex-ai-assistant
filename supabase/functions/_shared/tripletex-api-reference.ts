/**
 * Comprehensive Tripletex API v2 reference extracted from the official OpenAPI specification.
 * Used by task-planner and executors for precise field names, types, and required params.
 */

// ─── Endpoint Reference ─────────────────────────────────────────────────────

export const ENDPOINTS = {
  employee: {
    list: "GET /employee",
    get: "GET /employee/{id}",
    create: "POST /employee",
    update: "PUT /employee/{id}",
  },
  employment: {
    list: "GET /employee/employment",
    get: "GET /employee/employment/{id}",
    create: "POST /employee/employment",
    update: "PUT /employee/employment/{id}",
  },
  customer: {
    list: "GET /customer",
    get: "GET /customer/{id}",
    create: "POST /customer",
    update: "PUT /customer/{id}",
    delete: "DELETE /customer/{id}",
  },
  product: {
    list: "GET /product",
    get: "GET /product/{id}",
    create: "POST /product",
    update: "PUT /product/{id}",
    delete: "DELETE /product/{id}",
  },
  invoice: {
    list: "GET /invoice",
    get: "GET /invoice/{id}",
    create: "POST /invoice",
    registerPayment: "PUT /invoice/{id}/:payment",
  },
  order: {
    list: "GET /order",
    get: "GET /order/{id}",
    create: "POST /order",
    update: "PUT /order/{id}",
    delete: "DELETE /order/{id}",
    invoice: "PUT /order/{id}/:invoice",
  },
  project: {
    list: "GET /project",
    get: "GET /project/{id}",
    create: "POST /project",
    update: "PUT /project/{id}",
    delete: "DELETE /project/{id}",
  },
  department: {
    list: "GET /department",
    get: "GET /department/{id}",
    create: "POST /department",
    update: "PUT /department/{id}",
    delete: "DELETE /department/{id}",
  },
  travelExpense: {
    list: "GET /travelExpense",
    get: "GET /travelExpense/{id}",
    create: "POST /travelExpense",
    update: "PUT /travelExpense/{id}",
    delete: "DELETE /travelExpense/{id}",
  },
  voucher: {
    list: "GET /ledger/voucher",
    get: "GET /ledger/voucher/{id}",
    create: "POST /ledger/voucher",
    update: "PUT /ledger/voucher/{id}",
    delete: "DELETE /ledger/voucher/{id}",
  },
  contact: {
    list: "GET /contact",
    get: "GET /contact/{id}",
    create: "POST /contact",
    update: "PUT /contact/{id}",
  },
  supplier: {
    list: "GET /supplier",
    get: "GET /supplier/{id}",
    create: "POST /supplier",
    update: "PUT /supplier/{id}",
    delete: "DELETE /supplier/{id}",
  },
  company: {
    get: "GET /company/{id}",
  },
  vatType: {
    list: "GET /ledger/vatType",
  },
  account: {
    list: "GET /ledger/account",
  },
} as const;

// ─── Schema Reference (writable fields only) ────────────────────────────────

export const SCHEMA_REFERENCE = `
## Employee (POST/PUT /employee)
Writable fields:
- firstName: string
- lastName: string
- employeeNumber: string (optional)
- dateOfBirth: string (YYYY-MM-DD)
- email: string
- phoneNumberMobile: string
- phoneNumberHome: string
- phoneNumberWork: string
- nationalIdentityNumber: string
- dnumber: string
- bankAccountNumber: string
- iban: string
- bic: string
- userType: enum [STANDARD, EXTENDED, NO_ACCESS]
- isContact: boolean (true = external contact, not employee)
- comments: string
- address: { addressLine1, addressLine2, postalCode, city, country: {id} }
- department: { id }
- employeeCategory: { id }

NOTE: dateOfEmployment is NOT on Employee. Use POST /employee/employment with startDate instead.
NOTE: Administrator role is set via entitlements, not on Employee directly.

## Employment (POST/PUT /employee/employment)
- employee: { id } (REQUIRED)
- startDate: string (YYYY-MM-DD)
- endDate: string
- employmentId: string
- isMainEmployer: boolean (default true)
- taxDeductionCode: enum [loennFraHovedarbeidsgiver, loennFraBiarbeidsgiver, pensjon, ...]
- division: { id }

## Customer (POST/PUT /customer)
- name: string
- organizationNumber: string
- email: string
- invoiceEmail: string
- phoneNumber: string
- phoneNumberMobile: string
- description: string
- language: enum [NO, EN]
- isPrivateIndividual: boolean
- isSupplier: boolean
- isInactive: boolean
- singleCustomerInvoice: boolean
- invoiceSendMethod: enum [EMAIL, EHF, EFAKTURA, AVTALEGIRO, VIPPS, PAPER, MANUAL]
- postalAddress: { addressLine1, addressLine2, postalCode, city, country: {id} }
- physicalAddress: { addressLine1, addressLine2, postalCode, city, country: {id} }
- deliveryAddress: { addressLine1, addressLine2, postalCode, city, name, country: {id} }
- invoicesDueIn: integer
- invoicesDueInType: enum [DAYS, MONTHS, RECURRING_DAY_OF_MONTH]
- currency: { id }
- accountManager: { id }
- department: { id }
- customerNumber: integer
- supplierNumber: integer
- website: string

NOTE: Use postalAddress (NOT address) for customer addresses.

## Product (POST/PUT /product)
- name: string
- number: string
- description: string
- costExcludingVatCurrency: number
- priceExcludingVatCurrency: number
- priceIncludingVatCurrency: number
- isInactive: boolean
- isStockItem: boolean
- vatType: { id }
- currency: { id }
- department: { id }
- account: { id }
- supplier: { id }
- productUnit: { id }
- weight: number
- weightUnit: enum [kg, g, hg]
- volume: number
- volumeUnit: enum [cm3, dm3, m3]

## Invoice (POST /invoice)
- invoiceNumber: integer (0 = auto-generate)
- invoiceDate: string (YYYY-MM-DD)
- invoiceDueDate: string (YYYY-MM-DD)
- customer: { id } (REQUIRED)
- kid: string (KID number)
- comment: string
- orders: array of Order references
- currency: { id }
- invoiceRemark: { description }
- paymentTypeId: integer (for prepaid invoices)
- paidAmount: number (for prepaid invoices)

## Register Payment on Invoice (PUT /invoice/{id}/:payment)
Query parameters (NOT body):
- paymentDate: string (REQUIRED, YYYY-MM-DD)
- paymentTypeId: integer (REQUIRED)
- paidAmount: number (REQUIRED, in payment account currency)
- paidAmountCurrency: number (optional, required for foreign currency invoices)

## Order (POST/PUT /order)
- customer: { id } (REQUIRED)
- orderDate: string (REQUIRED, YYYY-MM-DD)
- deliveryDate: string
- receiverEmail: string
- reference: string
- ourContactEmployee: { id }
- department: { id }
- project: { id }
- invoiceComment: string
- currency: { id }
- invoicesDueIn: integer
- invoicesDueInType: enum [DAYS, MONTHS, RECURRING_DAY_OF_MONTH]
- orderLines: array of OrderLine
- contact: { id }
- isClosed: boolean

## OrderLine (embedded in Order)
- product: { id }
- description: string
- count: number
- unitPriceExcludingVatCurrency: number
- unitPriceIncludingVatCurrency: number
- vatType: { id }
- discount: number (percentage)
- markup: number (percentage)

## Create Invoice from Order (PUT /order/{id}/:invoice)
Query parameters (NOT body):
- invoiceDate: string (REQUIRED, YYYY-MM-DD)
- sendToCustomer: boolean
- sendType: string
- paymentTypeId: integer (for prepaid)
- paidAmount: number (for prepaid)
- invoiceIdIfIsCreditNote: integer (for credit notes)

## Project (POST/PUT /project)
- name: string (REQUIRED)
- number: string (auto if null)
- description: string
- projectManager: { id } (REQUIRED, must be Employee)
- department: { id }
- mainProject: { id }
- startDate: string (YYYY-MM-DD)
- endDate: string
- customer: { id }
- isClosed: boolean
- isInternal: boolean
- isOffer: boolean (true = offer, false = project)
- isFixedPrice: boolean
- projectCategory: { id }
- reference: string
- fixedprice: number
- currency: { id }
- contact: { id }
- invoiceComment: string
- accessType: enum [NONE, READ, WRITE]

## Department (POST/PUT /department)
- name: string (REQUIRED)
- departmentNumber: string
- departmentManager: { id } (Employee ref)
- isInactive: boolean

## TravelExpense (POST/PUT /travelExpense)
- employee: { id }
- title: string
- project: { id }
- department: { id }
- isChargeable: boolean
- travelAdvance: number
- travelDetails: {
    isForeignTravel: boolean,
    isDayTrip: boolean,
    isCompensationFromRates: boolean,
    departureDate: string (YYYY-MM-DD),
    returnDate: string (YYYY-MM-DD),
    departureFrom: string,
    destination: string,
    departureTime: string,
    returnTime: string,
    purpose: string,
    detailedJourneyDescription: string
  }
- costs: array of Cost objects
- perDiemCompensations: array of PerDiemCompensation objects

### Cost (travel expense line item)
- costCategory: { id } (TravelCostCategory ref)
- paymentType: { id } (TravelPaymentType ref)
- currency: { id }
- vatType: { id }
- amountCurrencyIncVat: number
- amountNOKInclVAT: number
- comments: string
- rate: number
- date: string (YYYY-MM-DD)
- isChargeable: boolean

### PerDiemCompensation
- rateType: { id }
- rateCategory: { id }
- countryCode: string
- overnightAccommodation: string
- location: string
- address: string
- count: integer
- rate: number
- amount: number
- isDeductionForBreakfast: boolean
- isDeductionForLunch: boolean
- isDeductionForDinner: boolean

## Voucher (POST/PUT /ledger/voucher)
- date: string (YYYY-MM-DD)
- description: string
- voucherType: { id }
- postings: array of Posting
- externalVoucherNumber: string (max 70 chars)

### Posting (voucher line)
- date: string (YYYY-MM-DD)
- description: string
- account: { id } (ledger account)
- amount: number
- amountCurrency: number
- amountGross: number
- amountGrossCurrency: number
- currency: { id }
- customer: { id }
- supplier: { id }
- employee: { id }
- project: { id }
- product: { id }
- department: { id }
- vatType: { id }
- row: integer

## Contact (POST/PUT /contact)
- firstName: string
- lastName: string
- email: string
- phoneNumberMobile: string
- phoneNumberWork: string
- customer: { id }
- department: { id }
- isInactive: boolean

## Supplier (POST/PUT /supplier)
- name: string
- organizationNumber: string
- email: string
- invoiceEmail: string
- phoneNumber: string
- phoneNumberMobile: string
- description: string
- isPrivateIndividual: boolean
- isCustomer: boolean
- isInactive: boolean
- postalAddress: { addressLine1, addressLine2, postalCode, city, country: {id} }
- physicalAddress: { addressLine1, addressLine2, postalCode, city, country: {id} }
- deliveryAddress: { addressLine1, addressLine2, postalCode, city, name, country: {id} }
- accountManager: { id }
- currency: { id }
- language: enum [NO, EN]
- website: string

NOTE: Use postalAddress (NOT address) for supplier addresses.

## Address (nested object)
- addressLine1: string
- addressLine2: string
- postalCode: string
- city: string
- country: { id } (Country ref, Norway = 161)

## Common Patterns
- All refs use { id: <number> } format, e.g. customer: { id: 123 }
- GET responses: { value: {...} } for single, { fullResultSize, values: [...] } for lists
- Use fields=* query param to get all fields in responses
- Norway country ID = 161
- Standard VAT 25% ID must be looked up via GET /ledger/vatType
`;

// ─── Compact reference for LLM system prompts ───────────────────────────────

export const COMPACT_API_REFERENCE = `Tripletex API v2 Quick Reference:

EMPLOYEE: POST/PUT /employee — fields: firstName, lastName, email, phoneNumberMobile, dateOfBirth(REQUIRED for employment), nationalIdentityNumber, bankAccountNumber, userType(STANDARD|EXTENDED|NO_ACCESS), address:{addressLine1,postalCode,city}, department:{id}. Employment dates via POST /employee/employment with employee:{id}, startDate.

EMPLOYEE ENTITLEMENTS: PUT /employee/{id}/entitlement/:grantEntitlementsByTemplate — queryParams: templateType (e.g. "all_administrator"). Use this to grant admin role AFTER creating employee with userType EXTENDED.

EMPLOYMENT: POST /employee/employment — fields: employee:{id}(REQ), startDate(REQ), employmentId, isMainEmployer, taxDeductionCode, division:{id}. NOTE: employee MUST have dateOfBirth set first.

CUSTOMER: POST/PUT /customer — fields: name, organizationNumber, email, phoneNumber, postalAddress:{addressLine1,postalCode,city,country:{id}}, invoiceSendMethod(EMAIL|EHF|PAPER|MANUAL), language(NO|EN), isPrivateIndividual, website. Use postalAddress NOT address.

PRODUCT: POST/PUT /product — fields: name, number, priceExcludingVatCurrency, priceIncludingVatCurrency, vatType:{id}, isStockItem, productUnit:{id}.

ORDER: POST /order — fields: customer:{id}(REQ), orderDate(REQ), orderLines:[{description, count, unitPriceExcludingVatCurrency, vatType:{id}}], deliveryDate, project:{id}.

INVOICE: Two paths:
  Path A: POST /invoice with customer:{id}, invoiceDate, invoiceDueDate, orders:[{id}]
  Path B: POST /order then PUT /order/{id}/:invoice?invoiceDate=YYYY-MM-DD
  Credit note: PUT /invoice/{id}/:createCreditNote?date=YYYY-MM-DD

PAYMENT: PUT /invoice/{id}/:payment — QUERY PARAMS (not body): paymentDate(REQ), paymentTypeId(REQ), paidAmount(REQ).

PROJECT: POST /project — fields: name(REQ), projectManager:{id}(REQ, employee), customer:{id}, startDate, endDate, isInternal, isFixedPrice, description.

DEPARTMENT: POST /department — fields: name(REQ), departmentNumber, departmentManager:{id}.

TRAVEL EXPENSE: POST /travelExpense — fields: employee:{id}, title, travelDetails:{departureDate,returnDate,departureFrom,destination,isDayTrip,isForeignTravel,purpose}, costs:[{costCategory:{id},amountCurrencyIncVat,date}].

VOUCHER: POST /ledger/voucher — fields: date, description, voucherType:{id}, postings:[{date,account:{id},amount,vatType:{id},description}].

CONTACT: POST /contact — fields: firstName, lastName, email, phoneNumberMobile, customer:{id}.

SUPPLIER: POST /supplier — fields: name, organizationNumber, email, phoneNumber, postalAddress:{addressLine1,postalCode,city,country:{id}}.

SALARY TRANSACTION: POST /salary/transaction — fields: year(REQ), month(REQ), payslips(REQ):[{employee:{id}, specifications:[{salaryType:{id}, count, rate, amount}]}]. GET /salary/type to look up salary types. Employee MUST have employment first.

COMPANY MODULES: POST /company/salesmodules — body: {salesModule:{id:MODULE_ID}}. Used to enable features like department accounting.

VAT TYPES: GET /ledger/vatType — look up VAT type IDs (e.g. 25% standard MVA).

ACCOUNTS: GET /ledger/account — look up ledger account IDs.

Key rules: refs always {id:N}. Norway country=161. GET responses: {value:{...}} or {values:[...]}. Always use fields=* on GET.`;
