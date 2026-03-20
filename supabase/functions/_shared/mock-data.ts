import { PipelineResult, ParsedTask, ExecutionPlan, StepResult } from "./types.ts";

export const SAMPLE_PROMPTS = {
  nb: "Opprett en ny kunde med navn Nordvik AS, e-post kontakt@nordvik.no og telefon +47 98765432",
  en: "Create a new customer named Acme Corp with email contact@acme.com and phone +47 12345678",
  es: "Crear un nuevo cliente llamado Empresa SL con correo info@empresa.es y número de organización 123456789",
  de: "Erstellen Sie einen neuen Mitarbeiter mit Vorname Hans, Nachname Müller, E-Mail hans@firma.de",
  nn: "Opprett ein ny tilsett med namn Kari Nordmann, e-post kari@example.no og stilling Rekneskapsførar",
  pt: "Registrar uma nova despesa de viagem para o funcionário João Silva, 1500 NOK para passagem aérea",
  fr: "Créer un nouveau produit appelé 'Consultation Premium' au prix de 2500 NOK",
};

export function getMockResult(taskPrompt: string): PipelineResult {
  const lower = taskPrompt.toLowerCase();

  const isPayment = ["betaling", "payment", "zahlung", "pago", "paiement", "pagamento", "betal", "paid", "bezahlt"]
    .some((kw) => lower.includes(kw));
  const isInvoice = ["faktura", "invoice", "rechnung", "factura", "facture", "fatura"]
    .some((kw) => lower.includes(kw));
  const isEmployee = ["ansatt", "employee", "mitarbeiter", "tilsett", "empleado", "employé"]
    .some((kw) => lower.includes(kw));
  const isProduct = ["produkt", "product", "producto", "produit", "produto"]
    .some((kw) => lower.includes(kw));
  const isProject = ["prosjekt", "project", "proyecto", "projekt", "projet", "projeto"]
    .some((kw) => lower.includes(kw));
  const isTravelDelete = ["slett", "delete", "eliminar", "supprimer", "excluir", "fjern", "remove"]
    .some((kw) => lower.includes(kw)) &&
    ["reiseregning", "travel expense", "gasto de viaje", "frais de voyage", "despesa de viagem", "reiseutgift"]
      .some((kw) => lower.includes(kw));

  if (isTravelDelete) return buildMockTravelExpenseDelete();
  if (isPayment) return buildMockPayment();
  if (isInvoice) return buildMockInvoice();
  if (isEmployee) return buildMockEmployee();
  if (isProduct) return buildMockProduct();
  if (isProject) return buildMockProject();
  return buildMockCustomer();
}

function buildMockCustomer(): PipelineResult {
  const parsed: ParsedTask = {
    language: "en",
    normalizedPrompt: "Create a new customer named Mock Corp",
    intent: "create",
    resourceType: "customer",
    fields: { name: "Mock Corp", email: "mock@corp.no", phoneNumber: "+47 11223344" },
    dependencies: [],
    confidence: 0.96,
    notes: "Mock mode — deterministic customer executor path",
  };

  const plan: ExecutionPlan = {
    summary: "Create customer: Mock Corp",
    steps: [{
      stepNumber: 1,
      description: 'POST /v2/customer — create "Mock Corp"',
      method: "POST",
      endpoint: "/v2/customer",
      body: { name: "Mock Corp", email: "mock@corp.no", phoneNumber: "+47 11223344", isCustomer: true, isSupplier: false },
      resultKey: "customerId",
    }],
  };

  return {
    status: "completed",
    language: "en",
    parsedTask: parsed,
    executionPlan: plan,
    stepResults: [{
      stepNumber: 1, success: true, statusCode: 201,
      data: { value: { id: 90001, name: "Mock Corp" } }, duration: 38,
    }],
    verificationPassed: true,
    logs: [],
    duration: 125,
  };
}

function buildMockEmployee(): PipelineResult {
  const parsed: ParsedTask = {
    language: "en",
    normalizedPrompt: "Create a new employee named Ola Nordmann",
    intent: "create",
    resourceType: "employee",
    fields: { firstName: "Ola", lastName: "Nordmann", email: "ola@example.no" },
    dependencies: [],
    confidence: 0.94,
    notes: "Mock mode — deterministic employee executor path",
  };

  const plan: ExecutionPlan = {
    summary: "Create employee: Ola Nordmann",
    steps: [{
      stepNumber: 1,
      description: 'POST /v2/employee — create "Ola Nordmann"',
      method: "POST",
      endpoint: "/v2/employee",
      body: { firstName: "Ola", lastName: "Nordmann", email: "ola@example.no" },
      resultKey: "employeeId",
    }],
  };

  return {
    status: "completed",
    language: "en",
    parsedTask: parsed,
    executionPlan: plan,
    stepResults: [{
      stepNumber: 1, success: true, statusCode: 201,
      data: { value: { id: 90002, firstName: "Ola", lastName: "Nordmann" } }, duration: 45,
    }],
    verificationPassed: true,
    logs: [],
    duration: 140,
  };
}

function buildMockProduct(): PipelineResult {
  const parsed: ParsedTask = {
    language: "en", normalizedPrompt: "Create a new product named Consulting Service",
    intent: "create", resourceType: "product",
    fields: { name: "Consulting Service", priceExcludingVatCurrency: 1500 },
    dependencies: [], confidence: 0.95, notes: "Mock mode — product executor path",
  };
  return {
    status: "completed", language: "en", parsedTask: parsed,
    executionPlan: { summary: "Create product: Consulting Service", steps: [{ stepNumber: 1, description: 'POST /v2/product', method: "POST", endpoint: "/v2/product", body: { name: "Consulting Service", priceExcludingVatCurrency: 1500 }, resultKey: "productId" }] },
    stepResults: [{ stepNumber: 1, success: true, statusCode: 201, data: { value: { id: 90003, name: "Consulting Service" } }, duration: 42 }],
    verificationPassed: true, logs: [], duration: 130,
  };
}

function buildMockProject(): PipelineResult {
  const parsed: ParsedTask = {
    language: "en", normalizedPrompt: "Create a new project called Website Redesign",
    intent: "create", resourceType: "project",
    fields: { name: "Website Redesign", customer: "Acme Corp" },
    dependencies: [], confidence: 0.93, notes: "Mock mode — project executor path",
  };
  return {
    status: "completed", language: "en", parsedTask: parsed,
    executionPlan: { summary: "Create project: Website Redesign", steps: [{ stepNumber: 1, description: 'POST /v2/project', method: "POST", endpoint: "/v2/project", body: { name: "Website Redesign" }, resultKey: "projectId" }] },
    stepResults: [{ stepNumber: 1, success: true, statusCode: 201, data: { value: { id: 90004, name: "Website Redesign" } }, duration: 50 }],
    verificationPassed: true, logs: [], duration: 150,
  };
}

function buildMockTravelExpenseDelete(): PipelineResult {
  const parsed: ParsedTask = {
    language: "en", normalizedPrompt: "Delete travel expense for employee",
    intent: "delete", resourceType: "travelExpense",
    fields: { employeeName: "Carlos García", date: "2024-03-15", amount: 1500 },
    dependencies: [], confidence: 0.91, notes: "Mock mode — travel expense delete path",
  };
  return {
    status: "completed", language: "en", parsedTask: parsed,
    executionPlan: { summary: "Delete travel expense ID 90005", steps: [{ stepNumber: 1, description: 'GET /v2/travelExpense — search', method: "GET", endpoint: "/v2/travelExpense", resultKey: "searchResult" }, { stepNumber: 2, description: 'DELETE /v2/travelExpense/90005', method: "DELETE", endpoint: "/v2/travelExpense/90005", resultKey: "deleteResult" }] },
    stepResults: [{ stepNumber: 1, success: true, statusCode: 200, data: { values: [{ id: 90005 }] }, duration: 35 }, { stepNumber: 2, success: true, statusCode: 204, data: null, duration: 28 }],
    verificationPassed: true, logs: [], duration: 160,
  };
}

function buildMockInvoice(): PipelineResult {
  const parsed: ParsedTask = {
    language: "en", normalizedPrompt: "Create invoice for Acme Corp",
    intent: "create", resourceType: "invoice",
    fields: {
      customerName: "Acme Corp", invoiceDate: "2026-03-20", dueDate: "2026-04-03",
      lineItems: [{ description: "Consulting", quantity: 5, unitPrice: 150 }],
    },
    dependencies: [], confidence: 0.92, notes: "Mock mode — invoice executor path",
  };
  return {
    status: "completed", language: "en", parsedTask: parsed,
    executionPlan: {
      summary: "Create invoice for Acme Corp, order 90010 → invoice 90011",
      steps: [
        { stepNumber: 1, description: 'GET /v2/customer — search "Acme Corp"', method: "GET", endpoint: "/v2/customer", queryParams: { name: "Acme Corp" }, resultKey: "customerSearch" },
        { stepNumber: 2, description: 'POST /v2/order — create order', method: "POST", endpoint: "/v2/order", resultKey: "orderId" },
        { stepNumber: 3, description: 'PUT /v2/order/90010/:invoice — create invoice', method: "PUT", endpoint: "/v2/order/90010/:invoice", resultKey: "invoiceId" },
      ],
    },
    stepResults: [
      { stepNumber: 1, success: true, statusCode: 200, data: { values: [{ id: 90001, name: "Acme Corp" }] }, duration: 30 },
      { stepNumber: 2, success: true, statusCode: 201, data: { value: { id: 90010 } }, duration: 45 },
      { stepNumber: 3, success: true, statusCode: 200, data: { value: { id: 90011 } }, duration: 40 },
    ],
    verificationPassed: true, logs: [], duration: 200,
  };
}

function buildMockPayment(): PipelineResult {
  const parsed: ParsedTask = {
    language: "en", normalizedPrompt: "Register payment for invoice 10030",
    intent: "create", resourceType: "payment",
    fields: { invoiceNumber: "10030", amount: 750, paymentDate: "2026-03-20", currency: "USD" },
    dependencies: [], confidence: 0.90, notes: "Mock mode — payment executor path",
  };
  return {
    status: "completed", language: "en", parsedTask: parsed,
    executionPlan: {
      summary: "Payment registered for invoice 90011, payment ID: 90020",
      steps: [
        { stepNumber: 1, description: 'GET /v2/invoice — search by number "10030"', method: "GET", endpoint: "/v2/invoice", queryParams: { invoiceNumber: "10030" }, resultKey: "invoiceSearch" },
        { stepNumber: 2, description: 'POST /v2/payment — register payment', method: "POST", endpoint: "/v2/payment", resultKey: "paymentId" },
      ],
    },
    stepResults: [
      { stepNumber: 1, success: true, statusCode: 200, data: { values: [{ id: 90011, invoiceNumber: 10030, amount: 750 }] }, duration: 30 },
      { stepNumber: 2, success: true, statusCode: 201, data: { value: { id: 90020 } }, duration: 35 },
    ],
    verificationPassed: true, logs: [], duration: 150,
  };
}

function buildMockDepartment(): PipelineResult {
  const parsed: ParsedTask = {
    language: "en", normalizedPrompt: "Create department Marketing",
    intent: "create", resourceType: "department",
    fields: { name: "Marketing", departmentNumber: "20" },
    dependencies: [], confidence: 0.91, notes: "Mock mode — department executor path",
  };
  return {
    status: "completed", language: "en", parsedTask: parsed,
    executionPlan: {
      summary: 'Department created: "Marketing", ID: 90030',
      steps: [{ stepNumber: 1, description: 'POST /v2/department — create "Marketing"', method: "POST", endpoint: "/v2/department", body: { name: "Marketing", departmentNumber: "20" }, resultKey: "departmentId" }],
    },
    stepResults: [{ stepNumber: 1, success: true, statusCode: 201, data: { value: { id: 90030, name: "Marketing" } }, duration: 32 }],
    verificationPassed: true, logs: [], duration: 110,
  };
}
