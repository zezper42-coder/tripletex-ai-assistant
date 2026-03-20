import { PipelineResult, ParsedTask, ExecutionPlan, StepResult } from "./types.ts";

export const SAMPLE_PROMPTS = {
  nb: "Opprett en ny ansatt med navn Ola Nordmann, e-post ola@example.no og stillingstittel Regnskapsfører",
  en: "Create a new customer named Acme Corp with email contact@acme.com and phone +47 12345678",
  es: "Crear una nueva factura para el cliente Acme Corp con una línea de producto por 5000 NOK",
  pt: "Registrar uma nova despesa de viagem para o funcionário João Silva, 1500 NOK para passagem aérea",
  nn: "Lag eit nytt prosjekt kalla 'Haustprosjekt 2024' knytt til kunde Fjord AS",
  de: "Erstellen Sie eine neue Abteilung namens 'Finanzen' mit der Abteilungsnummer 300",
  fr: "Créer un nouveau produit appelé 'Consultation Premium' au prix de 2500 NOK",
};

export function getMockResult(taskPrompt: string): PipelineResult {
  const parsed: ParsedTask = {
    language: "en",
    normalizedPrompt: taskPrompt,
    intent: "create",
    resourceType: "customer",
    fields: { name: "Mock Customer", email: "mock@test.com" },
    dependencies: [],
    confidence: 0.95,
    notes: "Mock mode — no real API calls made",
  };

  const plan: ExecutionPlan = {
    summary: "Mock: Create customer",
    steps: [
      {
        stepNumber: 1,
        description: "Create customer via POST /v2/customer",
        method: "POST",
        endpoint: "/v2/customer",
        body: { name: "Mock Customer", email: "mock@test.com" },
        resultKey: "customerId",
      },
    ],
  };

  const stepResults: StepResult[] = [
    {
      stepNumber: 1,
      success: true,
      statusCode: 201,
      data: { value: { id: 99999, name: "Mock Customer" } },
      duration: 42,
    },
  ];

  return {
    status: "completed",
    language: "en",
    parsedTask: parsed,
    executionPlan: plan,
    stepResults,
    verificationPassed: true,
    logs: [],
    duration: 150,
  };
}
