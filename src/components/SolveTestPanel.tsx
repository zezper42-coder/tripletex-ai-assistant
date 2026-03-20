import { useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SAMPLE_PROMPTS } from "@/lib/sample-prompts";
import AutoTrainPanel from "@/components/AutoTrainPanel";

interface AttachmentFile {
  filename: string;
  mimeType: string;
  base64: string;
}

interface PipelineResult {
  status: "completed" | "failed";
  language: string;
  parsedTask: {
    language: string;
    normalizedPrompt: string;
    intent: string;
    resourceType: string;
    fields: Record<string, unknown>;
    dependencies: unknown[];
    confidence: number;
    notes: string;
  } | null;
  executionPlan: {
    summary: string;
    steps: {
      stepNumber: number;
      description: string;
      method: string;
      endpoint: string;
      body?: unknown;
    }[];
  } | null;
  stepResults: {
    stepNumber: number;
    success: boolean;
    statusCode: number;
    data?: unknown;
    error?: string;
    duration: number;
  }[];
  verificationPassed: boolean;
  logs: {
    timestamp: string;
    level: string;
    module: string;
    message: string;
    data?: unknown;
  }[];
  duration: number;
  error?: string;
}

export default function SolveTestPanel() {
  const [task, setTask] = useState("");
  const [apiUrl, setApiUrl] = useState("https://api.tripletex.io");
  const [sessionToken, setSessionToken] = useState("");
  const [mockMode, setMockMode] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newAttachments: AttachmentFile[] = [];
    for (const file of Array.from(files)) {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      newAttachments.push({
        filename: file.name,
        mimeType: file.type,
        base64: btoa(binary),
      });
    }
    setAttachments((prev) => [...prev, ...newAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const removeAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  const runTask = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("solve", {
        body: {
          task,
          tripletexApiUrl: apiUrl,
          sessionToken,
          mockMode,
          attachments: attachments.length > 0 ? attachments : undefined,
        },
        headers: { "x-debug": "true" },
      });

      if (fnError) throw fnError;
      setResult(data as PipelineResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [task, apiUrl, sessionToken, mockMode, attachments]);

  const loadSample = (lang: string) => {
    setTask(SAMPLE_PROMPTS[lang as keyof typeof SAMPLE_PROMPTS] || "");
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">
            Tripletex AI Agent — Test Console
          </h1>
          <p className="text-sm text-muted-foreground">
            NM i AI — POST /solve pipeline debugger
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Input Panel */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Task Input</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="task">Task Prompt</Label>
                  <Textarea
                    id="task"
                    value={task}
                    onChange={(e) => setTask(e.target.value)}
                    placeholder="Enter accounting task in any language..."
                    className="min-h-[120px] font-mono text-sm"
                  />
                  <div className="flex flex-wrap gap-1">
                    {Object.keys(SAMPLE_PROMPTS).map((lang) => (
                      <Button
                        key={lang}
                        variant="outline"
                        size="sm"
                        className="text-xs h-6 px-2"
                        onClick={() => loadSample(lang)}
                      >
                        {lang.toUpperCase()}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* File Upload */}
                <div className="space-y-2">
                  <Label>Attachments (PDF/Image)</Label>
                  <Input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.tiff"
                    onChange={handleFileChange}
                    className="text-sm"
                  />
                  {attachments.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {attachments.map((a, i) => (
                        <Badge
                          key={i}
                          variant="secondary"
                          className="text-xs cursor-pointer"
                          onClick={() => removeAttachment(i)}
                        >
                          {a.filename} ✕
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="apiUrl">Tripletex API URL</Label>
                    <Input
                      id="apiUrl"
                      value={apiUrl}
                      onChange={(e) => setApiUrl(e.target.value)}
                      className="font-mono text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="token">Session Token</Label>
                    <Input
                      id="token"
                      type="password"
                      value={sessionToken}
                      onChange={(e) => setSessionToken(e.target.value)}
                      placeholder="Tripletex session token"
                      className="font-mono text-sm"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={mockMode}
                      onCheckedChange={setMockMode}
                      id="mock"
                    />
                    <Label htmlFor="mock" className="text-sm cursor-pointer">
                      Mock mode
                    </Label>
                  </div>
                  <Button
                    onClick={runTask}
                    disabled={loading || !task.trim()}
                    className="min-w-[120px]"
                  >
                    {loading ? "Running…" : "Run Task"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Results Panel */}
          <div className="space-y-4">
            {error && (
              <Card className="border-destructive">
                <CardContent className="pt-4">
                  <p className="text-sm text-destructive font-mono">{error}</p>
                </CardContent>
              </Card>
            )}

            {result && (
              <>
                <div className="flex items-center gap-3">
                  <Badge
                    variant={result.status === "completed" ? "default" : "destructive"}
                    className="text-sm"
                  >
                    {result.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {result.duration}ms
                  </span>
                  {result.verificationPassed && (
                    <Badge variant="outline" className="text-xs">
                      ✓ verified
                    </Badge>
                  )}
                  {result.language && result.language !== "unknown" && (
                    <Badge variant="secondary" className="text-xs">
                      {result.language}
                    </Badge>
                  )}
                </div>

                <Tabs defaultValue="parsed" className="w-full">
                  <TabsList className="w-full grid grid-cols-4">
                    <TabsTrigger value="parsed" className="text-xs">Parsed</TabsTrigger>
                    <TabsTrigger value="plan" className="text-xs">Plan</TabsTrigger>
                    <TabsTrigger value="results" className="text-xs">Results</TabsTrigger>
                    <TabsTrigger value="logs" className="text-xs">Logs</TabsTrigger>
                  </TabsList>

                  <TabsContent value="parsed">
                    <Card>
                      <CardContent className="pt-4">
                        {result.parsedTask ? (
                          <ScrollArea className="h-[350px]">
                            <pre className="text-xs font-mono whitespace-pre-wrap break-words">
                              {JSON.stringify(result.parsedTask, null, 2)}
                            </pre>
                          </ScrollArea>
                        ) : (
                          <p className="text-sm text-muted-foreground">No parsed data</p>
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>

                  <TabsContent value="plan">
                    <Card>
                      <CardContent className="pt-4">
                        {result.executionPlan ? (
                          <ScrollArea className="h-[350px]">
                            <div className="space-y-3">
                              <p className="text-sm font-medium">{result.executionPlan.summary}</p>
                              {result.executionPlan.steps.map((step) => (
                                <div key={step.stepNumber} className="border rounded p-2 space-y-1">
                                  <div className="flex items-center gap-2">
                                    <Badge variant="outline" className="text-xs font-mono">
                                      {step.method}
                                    </Badge>
                                    <code className="text-xs">{step.endpoint}</code>
                                  </div>
                                  <p className="text-xs text-muted-foreground">{step.description}</p>
                                </div>
                              ))}
                            </div>
                          </ScrollArea>
                        ) : (
                          <p className="text-sm text-muted-foreground">No plan data</p>
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>

                  <TabsContent value="results">
                    <Card>
                      <CardContent className="pt-4">
                        <ScrollArea className="h-[350px]">
                          {result.stepResults.length > 0 ? (
                            <div className="space-y-2">
                              {result.stepResults.map((sr) => (
                                <div key={sr.stepNumber} className="border rounded p-2 space-y-1">
                                  <div className="flex items-center gap-2">
                                    <Badge variant={sr.success ? "default" : "destructive"} className="text-xs">
                                      Step {sr.stepNumber}
                                    </Badge>
                                    <code className="text-xs">{sr.statusCode}</code>
                                    <span className="text-xs text-muted-foreground">{sr.duration}ms</span>
                                  </div>
                                  {sr.error && (
                                    <p className="text-xs text-destructive">{sr.error}</p>
                                  )}
                                  {sr.data && (
                                    <pre className="text-xs font-mono mt-1 whitespace-pre-wrap break-words max-h-24 overflow-auto">
                                      {JSON.stringify(sr.data, null, 2)}
                                    </pre>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground">No results</p>
                          )}
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  </TabsContent>

                  <TabsContent value="logs">
                    <Card>
                      <CardContent className="pt-4">
                        <ScrollArea className="h-[350px]">
                          <div className="space-y-0.5">
                            {result.logs.map((log, i) => (
                              <div key={i} className="font-mono text-xs leading-relaxed">
                                <span className="text-muted-foreground">
                                  {log.timestamp.split("T")[1]?.slice(0, 12)}
                                </span>{" "}
                                <span
                                  className={
                                    log.level === "error"
                                      ? "text-destructive"
                                      : log.level === "warn"
                                      ? "text-yellow-500"
                                      : "text-muted-foreground"
                                  }
                                >
                                  [{log.level}]
                                </span>{" "}
                                <span className="text-primary">[{log.module}]</span>{" "}
                                {log.message}
                              </div>
                            ))}
                            {result.logs.length === 0 && (
                              <p className="text-sm text-muted-foreground">No logs</p>
                            )}
                          </div>
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  </TabsContent>
                </Tabs>
              </>
            )}

            {!result && !error && !loading && (
              <Card>
                <CardContent className="pt-6 pb-6">
                  <p className="text-sm text-muted-foreground text-center">
                    Enter a task and click "Run Task" to test the pipeline
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
