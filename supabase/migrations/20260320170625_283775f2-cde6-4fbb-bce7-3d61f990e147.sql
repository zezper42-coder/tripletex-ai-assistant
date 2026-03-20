CREATE TABLE public.learned_solutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type TEXT NOT NULL,
  intent TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  task_signature TEXT NOT NULL,
  execution_plan JSONB NOT NULL,
  success_count INTEGER NOT NULL DEFAULT 1,
  last_used_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_learned_solutions_signature ON public.learned_solutions (task_signature);
CREATE INDEX idx_learned_solutions_task_type ON public.learned_solutions (task_type);

ALTER TABLE public.learned_solutions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to learned_solutions"
ON public.learned_solutions
FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);