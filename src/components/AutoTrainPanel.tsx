import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";

const RESOURCE_TYPES = [
  "customer", "employee", "invoice", "payment", "creditNote",
  "voucher", "travelExpense", "project", "department", "supplier",
  "contact", "product",
];

interface TrainResult {
  task: string;
  category: string;
  language: string;
  status: "completed" | "failed";
  swarmUsed: boolean;
  duration: number;
  error?: string;
  solutionLearned: boolean;
}

interface TrainResponse {
  totalRuns: number;
  succeeded: number;
  failed: number;
  newSolutionsLearned: number;
  results: TrainResult[];
}

interface AutoTrainPanelProps {
  apiUrl: string;
  sessionToken: string;
}

export default function AutoTrainPanel({ apiUrl, sessionToken }: AutoTrainPanelProps) {
  const [iterations, setIterations] = useState(10);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [mockMode, setMockMode] = useState(true);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<TrainResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggleCategory = (cat: string) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const selectAll = () => setSelectedCategories([...RESOURCE_TYPES]);
  const selectNone = () => setSelectedCategories([]);

  const runTraining = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResponse(null);

    const payload = {
      tripletexApiUrl: apiUrl,
      sessionToken,
      iterations,
      categories: selectedCategories.length > 0 ? selectedCategories : undefined,
      mockMode,
    };

    try {
      const { data, error: fnError } = await supabase.functions.invoke("auto-train", {
        body: payload,
      });

      if (fnError) {
        const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auto-train`;
        const fallbackResponse = await fetch(functionUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify(payload),
        });

        const fallbackData = await fallbackResponse.json().catch(() => null);
        if (!fallbackResponse.ok) {
          throw new Error(
            fallbackData?.error || fnError.message || "Failed to send a request to the Edge Function"
          );
        }

        setResponse(fallbackData as TrainResponse);
        return;
      }

      setResponse(data as TrainResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [apiUrl, sessionToken, iterations, selectedCategories, mockMode]);

  const successRate = response
    ? Math.round((response.succeeded / response.totalRuns) * 100)
    : 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Training Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="iterations">Iterations</Label>
              <Input
                id="iterations"
                type="number"
                min={1}
                max={50}
                value={iterations}
                onChange={(e) => setIterations(Number(e.target.value))}
                className="font-mono text-sm"
              />
            </div>
            <div className="flex items-end pb-1">
              <div className="flex items-center gap-2">
                <Switch checked={mockMode} onCheckedChange={setMockMode} id="train-mock" />
                <Label htmlFor="train-mock" className="text-sm cursor-pointer">Mock mode</Label>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Categories</Label>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" className="text-xs h-6 px-2" onClick={selectAll}>All</Button>
                <Button variant="ghost" size="sm" className="text-xs h-6 px-2" onClick={selectNone}>None</Button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {RESOURCE_TYPES.map((cat) => (
                <label key={cat} className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <Checkbox
                    checked={selectedCategories.includes(cat)}
                    onCheckedChange={() => toggleCategory(cat)}
                    className="h-3.5 w-3.5"
                  />
                  {cat}
                </label>
              ))}
            </div>
          </div>

          <Button
            onClick={runTraining}
            disabled={loading || (!mockMode && !sessionToken)}
            className="w-full"
          >
            {loading ? "Training…" : "Start Training"}
          </Button>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-4">
            <p className="text-sm text-destructive font-mono">{error}</p>
          </CardContent>
        </Card>
      )}

      {loading && (
        <Card>
          <CardContent className="pt-4 space-y-2">
            <p className="text-sm text-muted-foreground">Running training pipeline…</p>
            <Progress value={undefined} className="h-2" />
          </CardContent>
        </Card>
      )}

      {response && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-4 gap-2">
            <Card>
              <CardContent className="pt-3 pb-3 text-center">
                <p className="text-2xl font-bold">{response.totalRuns}</p>
                <p className="text-xs text-muted-foreground">Total</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-3 pb-3 text-center">
                <p className="text-2xl font-bold text-primary">{response.succeeded}</p>
                <p className="text-xs text-muted-foreground">Passed</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-3 pb-3 text-center">
                <p className="text-2xl font-bold text-destructive">{response.failed}</p>
                <p className="text-xs text-muted-foreground">Failed</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-3 pb-3 text-center">
                <p className="text-2xl font-bold text-primary">{response.newSolutionsLearned}</p>
                <p className="text-xs text-muted-foreground">Learned</p>
              </CardContent>
            </Card>
          </div>

          <Progress value={successRate} className="h-2" />
          <p className="text-xs text-muted-foreground text-center">{successRate}% success rate</p>

          {/* Results table */}
          <Card>
            <CardContent className="pt-4">
              <ScrollArea className="h-[350px]">
                <div className="space-y-1.5">
                  {response.results.map((r, i) => (
                    <div key={i} className="border rounded p-2 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge
                          variant={r.status === "completed" ? "default" : "destructive"}
                          className="text-xs"
                        >
                          {r.status}
                        </Badge>
                        <Badge variant="outline" className="text-xs font-mono">{r.category}</Badge>
                        <Badge variant="secondary" className="text-xs">{r.language}</Badge>
                        <span className="text-xs text-muted-foreground">{r.duration}ms</span>
                        {r.swarmUsed && (
                          <Badge variant="outline" className="text-xs">swarm</Badge>
                        )}
                        {r.solutionLearned && (
                          <Badge variant="secondary" className="text-xs">learned</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{r.task}</p>
                      {r.error && <p className="text-xs text-destructive">{r.error}</p>}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </>
      )}

      {!response && !error && !loading && (
        <Card>
          <CardContent className="pt-6 pb-6">
            <p className="text-sm text-muted-foreground text-center">
              Configure settings and click "Start Training" to auto-generate and solve tasks
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
