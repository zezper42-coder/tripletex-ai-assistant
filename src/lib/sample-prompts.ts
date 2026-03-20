export const SAMPLE_PROMPTS: Record<string, string> = {
  // Customer creation
  nb_customer: "Opprett en ny kunde med navn Nordvik AS, e-post kontakt@nordvik.no og telefon +47 98765432",
  en_customer: "Create a new customer named Acme Corp with email contact@acme.com and phone +47 12345678",
  es_customer: "Crear un nuevo cliente llamado Empresa SL con correo info@empresa.es y número de organización 123456789",
  // Employee creation
  de_employee: "Erstellen Sie einen neuen Mitarbeiter mit Vorname Hans, Nachname Müller, E-Mail hans@firma.de",
  nn_employee: "Opprett ein ny tilsett med namn Kari Nordmann, e-post kari@example.no og stilling Rekneskapsførar",
  // Product creation
  nb_product: "Opprett et nytt produkt med navn 'Konsulenttjeneste' og pris 1500 NOK ekskl. mva",
  de_product: "Erstellen Sie ein neues Produkt mit dem Namen 'Beratung Premium' zum Preis von 2500 NOK",
  // Project creation
  en_project: "Create a new project called 'Website Redesign' linked to customer Acme Corp",
  pt_project: "Criar um novo projeto chamado 'Migração de Dados' com descrição 'Migrar dados do sistema antigo'",
  // Travel expense deletion
  es_travel_delete: "Eliminar la nota de gastos de viaje del empleado Carlos García del 15 de marzo por 1500 NOK",
  fr_travel_delete: "Supprimer la note de frais de voyage de l'employé Pierre Dupont du 10 mars pour 2000 NOK",
  // Invoice creation
  nb_invoice: "Opprett en faktura til kunde Nordvik AS for konsulenttjenester, 10 timer à 1200 NOK",
  en_invoice: "Create an invoice for customer Acme Corp for 5 hours of consulting at 150 USD each",
  de_invoice: "Erstellen Sie eine Rechnung für Kunde Schmidt GmbH: 3 Stunden Beratung à 200 EUR",
  es_invoice: "Crear una factura para el cliente Empresa SL por 2 servicios de consultoría a 500 EUR cada uno",
  en_invoice_multi: "Invoice Globex Corp for: 10x Widget A at $50, 5x Widget B at $75, 2x Premium Support at $200",
  nb_invoice_new_customer: "Lag faktura til ny kunde Fjordtech AS (post@fjordtech.no) for 20 timer rådgivning à 950 NOK",
  // Payment creation
  nb_payment: "Registrer betaling på faktura 10025 for Nordvik AS, 12500 NOK, betalt 20. mars 2026",
  en_payment: "Mark invoice #10030 as paid, amount 750 USD, payment date 2026-03-20",
  de_payment: "Zahlung für Rechnung 10042 registrieren, Betrag 2000 EUR, Kunde Schmidt GmbH",
  es_payment: "Registrar pago de la factura del cliente Empresa SL por 500 EUR",
  pt_payment: "Registrar pagamento da fatura 10050 no valor de 3000 BRL",
  fr_payment: "Enregistrer le paiement de la facture #10055 de 1500 EUR pour le client Dupont SARL",
  // Department creation
  nb_department: "Opprett en ny avdeling med navn Salg og avdelingsnummer 10",
  en_department: "Create a new department called Marketing with department number 20",
  de_department: "Erstellen Sie eine neue Abteilung namens Buchhaltung mit Nummer 30",
  es_department: "Crear un nuevo departamento llamado Ventas con número 10",
  pt_department: "Criar um novo departamento chamado Financeiro com número 40",
  fr_department: "Créer un nouveau département nommé Ressources Humaines avec le numéro 50",
  // Travel expense creation
  nb_travel_create: "Opprett reiseregning for Ola Nordmann, reise fra Bergen til Oslo 18. mars 2026, tog og hotell 1250 NOK",
  en_travel_create: "Create a travel expense for employee john.doe@company.com, March 18 2026, flight from London to Oslo, 3500 NOK",
  de_travel_create: "Erstellen Sie eine Reisekostenabrechnung für Mitarbeiter Hans Müller, 500 EUR, Zugfahrt Hamburg-Berlin",
  es_travel_create: "Crear un gasto de viaje para el empleado Carlos García, 15 de marzo, 1500 NOK, reunión con cliente",
  en_travel_create_email: "Register travel expense for jane.smith@acme.no, travel date 2026-03-20, purpose: customer meeting, amount 2800 NOK",
  nb_travel_create_route: "Registrer reiseregning for Kari Nordmann fra Trondheim til Stavanger, formål kundemøte, 2200 NOK",
  // Credit note creation
  nb_credit_note: "Opprett kreditnota for faktura 10025, feil beløp",
  en_credit_note: "Create a credit note for invoice #10030, reason: duplicate billing",
  de_credit_note: "Gutschrift für Rechnung 10042 erstellen, Grund: falscher Betrag",
  es_credit_note: "Crear una nota de crédito para la factura del cliente Empresa SL",
  pt_credit_note: "Criar nota de crédito para a fatura 10050, motivo: cobrança duplicada",
  fr_credit_note: "Créer une note de crédit pour la facture #10055 du client Dupont SARL",
};
