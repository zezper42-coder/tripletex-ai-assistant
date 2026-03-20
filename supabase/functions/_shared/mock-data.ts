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
