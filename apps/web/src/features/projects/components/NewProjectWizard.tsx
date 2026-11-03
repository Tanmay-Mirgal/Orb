"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, ArrowRight, Check, Cog, Container, Globe, Lock, Rocket, Search, Server, Timer,
} from "lucide-react";
import { getOrgPlan, imageDisplayName, imageReferenceError, INSTANCE_PLANS, parseDotenv } from "shared";
import { cn } from "@/lib/utils";
import { api, errorMessage } from "@/lib/api-client";
import { timeAgo } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { GithubIcon, PageHeader } from "@/components/app/page";

type ProjectKind = "static" | "web_service" | "worker" | "cron";
type Source = "git" | "image";
interface Repo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  language: string | null;
  default_branch: string;
  updated_at: string;
}

const KINDS: Array<{ id: ProjectKind; title: string; text: string; examples: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "static", title: "Static site", text: "Pre-built HTML/CSS/JS served from the edge.", examples: "Vite, React, Astro, Docusaurus, plain HTML", icon: Globe },
  { id: "web_service", title: "Web service", text: "A long-running server with a public URL, health checks and zero-downtime releases.", examples: "Next.js, Express, NestJS, Flask, FastAPI, Go, Docker", icon: Server },
  { id: "worker", title: "Background worker", text: "Always-on process without a public port.", examples: "Queue consumers, bots, stream processors", icon: Cog },
  { id: "cron", title: "Cron job", text: "A container that runs on a schedule and exits.", examples: "Reports, cleanups, syncs", icon: Timer },
];

const STEPS = ["Type", "Source", "Configure"];

function Stepper({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-2 text-sm" aria-label="Progress">
      {STEPS.map((label, i) => (
        <li key={label} className="flex items-center gap-2">
          <span
            className={cn(
              "flex size-6 items-center justify-center rounded-full border text-xs font-semibold",
              i < step ? "border-accent bg-accent text-accent-foreground" : i === step ? "border-foreground text-foreground" : "text-muted-foreground",
            )}
          >
            {i < step ? <Check className="size-3.5" /> : i + 1}
          </span>
          <span className={cn("hidden sm:inline", i === step ? "font-medium" : "text-muted-foreground")}>{label}</span>
          {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-border sm:w-10" />}
        </li>
      ))}
    </ol>
  );
}

export function NewProjectWizard({ planId }: { planId: string }) {
  const router = useRouter();
  const toast = useToast();
  const plan = getOrgPlan(planId);

  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<ProjectKind>("web_service");
  const [source, setSource] = useState<Source>("git");
  const [image, setImage] = useState("");
  const [regUser, setRegUser] = useState("");
  const [regPass, setRegPass] = useState("");
  const [imagePort, setImagePort] = useState(""); // empty = detect from the image
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [repo, setRepo] = useState<Repo | null>(null);
  const [branches, setBranches] = useState<string[]>([]);

  const [detecting, setDetecting] = useState(false);
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("main");
  const [rootDir, setRootDir] = useState("");
  const [framework, setFramework] = useState("");
  const [installCmd, setInstallCmd] = useState("");
  const [buildCmd, setBuildCmd] = useState("");
  const [outputDir, setOutputDir] = useState("dist");
  const [startCmd, setStartCmd] = useState("");
  const [port, setPort] = useState(3000);
  const [healthPath, setHealthPath] = useState("/");
  const [schedule, setSchedule] = useState("0 * * * *");
  const [instancePlan, setInstancePlan] = useState("free");
  const [envText, setEnvText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Repositories are fetched once the user reaches step 2 (and only when deploying from Git).
  useEffect(() => {
    if (step < 1 || repos || source !== "git") return;
    api<{ repos: Repo[] }>("/api/v1/github/repos")
      .then((d) => setRepos(d.repos))
      .catch((e) => {
        setRepoError(errorMessage(e));
        setRepos([]);
      });
  }, [step, repos, source]);

  // Branches + framework detection (the same detector the build worker uses) when a repo is picked or the root changes.
  useEffect(() => {
    if (!repo) return;
    api<{ branches: string[] }>(`/api/v1/github/branches?repo=${encodeURIComponent(repo.full_name)}`)
      .then((d) => setBranches(d.branches))
      .catch(() => setBranches([repo.default_branch]));
  }, [repo]);

  useEffect(() => {
    if (!repo || step < 2) return;
    setDetecting(true);
    const t = setTimeout(async () => {
      try {
        const { detection } = await api(`/api/v1/github/detect?repo=${encodeURIComponent(repo.full_name)}&branch=${encodeURIComponent(branch)}&rootDir=${encodeURIComponent(rootDir)}`);
        setFramework(detection.frameworkName);
        setInstallCmd(detection.installCommand);
        setBuildCmd(detection.buildCommand);
        setOutputDir(detection.outputDirectory);
        setStartCmd(detection.startCommand);
        setPort(detection.port);
        // Nudge the type if the repository clearly is something else, but never override an explicit choice silently.
        if (kind === "static" && detection.suggestedType === "web_service") toast.info(`${detection.frameworkName} looks like a server app`, "You can switch to “Web service” by going back one step.");
      } catch {
        /* detection is best effort */
      } finally {
        setDetecting(false);
      }
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, branch, rootDir, step]);

  const filtered = useMemo(() => (repos ?? []).filter((r) => r.full_name.toLowerCase().includes(search.toLowerCase())), [repos, search]);
  const env = useMemo(() => parseDotenv(envText), [envText]);
  const isServer = kind !== "static";
  const isImage = source === "image";
  const imageProblem = image.trim() ? imageReferenceError(image) : null;
  const imageReady = image.trim().length > 0 && !imageProblem;
  const portValue = imagePort.trim() === "" ? 0 : Number(imagePort);
  const portInvalid = isImage && kind === "web_service" && imagePort.trim() !== "" && !(Number.isInteger(portValue) && portValue >= 1 && portValue <= 65535);

  const pickRepo = (r: Repo) => {
    setRepo(r);
    setName(r.name);
    setBranch(r.default_branch || "main");
    setStep(2);
  };

  const pickImage = () => {
    setName((n) => n || imageDisplayName(image.trim()));
    setStep(2);
  };

  const chooseSource = (next: Source) => {
    setSource(next);
    setError(null);
  };

  const submit = async () => {
    if (isImage ? !imageReady : !repo) return;
    setSubmitting(true);
    setError(null);
    try {
      const common = {
        name,
        type: kind,
        startCommand: isServer ? startCmd.trim() || undefined : undefined,
        cronSchedule: kind === "cron" ? schedule : undefined,
        instancePlan: isServer ? instancePlan : undefined,
        deploy: true,
      };
      const body = isImage
        ? {
            ...common,
            source: "image",
            image: image.trim(),
            registry: regUser.trim() && regPass ? { username: regUser.trim(), password: regPass } : undefined,
            port: kind === "web_service" ? portValue : undefined,
            healthCheckPath: kind === "web_service" ? healthPath : undefined,
            // A prebuilt image has no build step, so its variables only matter when the container starts.
            envVars: env.vars.map((v) => ({ key: v.key, value: v.value, target: "all", scope: "runtime", isSecret: true })),
          }
        : {
            ...common,
            source: "git",
            repository: { fullName: repo!.full_name, id: repo!.id, branch },
            framework: framework || undefined,
            rootDirectory: rootDir,
            installCommand: installCmd || undefined,
            buildCommand: buildCmd || undefined,
            outputDirectory: kind === "static" ? outputDir || undefined : undefined,
            port: kind === "web_service" ? port : undefined,
            healthCheckPath: kind === "web_service" ? healthPath : undefined,
            envVars: env.vars.map((v) => ({ key: v.key, value: v.value, target: "all", scope: "both", isSecret: true })),
          };
      const data = await api("/api/v1/projects", { method: "POST", body: JSON.stringify(body) });
      toast.success("Project created", "Your first deployment is building.");
      router.push(`/dashboard/projects/${data.project.slug}`);
    } catch (e) {
      setError(errorMessage(e));
      setSubmitting(false);
    }
  };

  return (
    <div className="animate-fade-up mx-auto max-w-3xl space-y-8">
      <PageHeader title="Create a new project" description="Deploy from a Git repository or a Docker image in a few steps." actions={<Stepper step={step} />} />

      {/* ───────── Step 1: type ───────── */}
      {step === 0 && (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2">
            {KINDS.map((k) => (
              <button
                key={k.id}
                onClick={() => {
                  setKind(k.id);
                  if (k.id === "static") setSource("git"); // static sites are built from a repository
                }}
                aria-pressed={kind === k.id}
                className={cn(
                  "flex flex-col gap-3 rounded-xl border bg-card p-5 text-left shadow-sm transition-all hover:border-foreground/30",
                  kind === k.id && "border-accent ring-2 ring-accent/30",
                )}
              >
                <span className={cn("flex size-10 items-center justify-center rounded-lg border", kind === k.id ? "border-accent/40 bg-accent-soft text-accent" : "bg-secondary text-muted-foreground")}>
                  <k.icon className="size-5" />
                </span>
                <div>
                  <h3 className="text-[15px] font-semibold">{k.title}</h3>
                  <p className="mt-1 text-[13px] text-muted-foreground">{k.text}</p>
                  <p className="mt-2 text-xs text-muted-foreground/80">{k.examples}</p>
                </div>
              </button>
            ))}
          </div>
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Container className="size-4 shrink-0" /> Web services, workers and cron jobs can also run a ready-made Docker image — you choose the source in the next step.
          </p>
          <div className="flex justify-end">
            <Button onClick={() => setStep(1)}>
              Continue <ArrowRight />
            </Button>
          </div>
        </div>
      )}

      {/* ───────── Step 2: source (repository or Docker image) ───────── */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" onClick={() => setStep(0)} aria-label="Back">
              <ArrowLeft />
            </Button>
            <div className="grid flex-1 gap-3 sm:grid-cols-2">
              {([
                { id: "git", title: "GitHub repository", text: "Orb clones, builds and deploys your code.", icon: GithubIcon, disabled: false },
                { id: "image", title: "Docker image", text: kind === "static" ? "Not available for static sites." : "Pull a prebuilt image from Docker Hub, GHCR or any registry.", icon: Container, disabled: kind === "static" },
              ] as const).map((s) => (
                <button
                  key={s.id}
                  disabled={s.disabled}
                  onClick={() => chooseSource(s.id)}
                  aria-pressed={source === s.id}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border bg-card p-3.5 text-left shadow-sm transition-all hover:border-foreground/30 disabled:cursor-not-allowed disabled:opacity-50",
                    source === s.id && "border-accent ring-2 ring-accent/30",
                  )}
                >
                  <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg border", source === s.id ? "border-accent/40 bg-accent-soft text-accent" : "bg-secondary text-muted-foreground")}>
                    <s.icon className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{s.title}</span>
                    <span className="block text-xs text-muted-foreground">{s.text}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {isImage && (
            <Card className="space-y-5 p-5">
              <Field label="Docker image" hint="Image name with an optional tag or digest. Without a tag, latest is used.">
                <Input
                  className="font-mono text-[13px]"
                  value={image}
                  onChange={(e) => setImage(e.target.value)}
                  placeholder="nginx:1.27   ·   ghcr.io/owner/app:latest   ·   owner/app"
                  autoFocus
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-invalid={Boolean(imageProblem)}
                />
                {imageProblem && <p className="text-xs text-destructive">{imageProblem}</p>}
              </Field>
              <details className="group text-sm" open={Boolean(regUser || regPass)}>
                <summary className="cursor-pointer text-[13px] font-medium text-muted-foreground hover:text-foreground">Private image? Add registry login</summary>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <Field label="Username">
                    <Input value={regUser} onChange={(e) => setRegUser(e.target.value)} autoComplete="off" />
                  </Field>
                  <Field label="Password or access token">
                    <Input type="password" value={regPass} onChange={(e) => setRegPass(e.target.value)} autoComplete="new-password" />
                  </Field>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Stored encrypted and used only to pull this image. Docker Hub also needs it when you hit the anonymous pull limit.</p>
              </details>
              <div className="flex justify-end">
                <Button onClick={pickImage} disabled={!imageReady || Boolean(regUser.trim()) !== Boolean(regPass)}>
                  Continue <ArrowRight />
                </Button>
              </div>
            </Card>
          )}

          {!isImage && (
          <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search your repositories…" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
          </div>

          <Card className="overflow-hidden">
            {repos === null ? (
              <div className="divide-y">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 p-4">
                    <Skeleton className="size-9 rounded-lg" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="h-3 w-28" />
                    </div>
                  </div>
                ))}
              </div>
            ) : repoError ? (
              <EmptyState className="border-0" icon={GithubIcon} title="Couldn't load your repositories" description={repoError} action={<Button onClick={() => { setRepos(null); setRepoError(null); }}>Retry</Button>} />
            ) : filtered.length === 0 ? (
              <EmptyState className="border-0" icon={Search} title="No repositories found" description={search ? "Try a different search." : "Grant Orb access to a repository on GitHub, then retry."} />
            ) : (
              <ul className="scroll-thin max-h-[460px] divide-y overflow-y-auto">
                {filtered.map((r) => (
                  <li key={r.id}>
                    <button onClick={() => pickRepo(r)} className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-secondary/60">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-secondary">
                        <GithubIcon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{r.full_name}</span>
                          {r.private && (
                            <Badge variant="outline">
                              <Lock className="size-3" /> Private
                            </Badge>
                          )}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {r.language ?? "—"} · updated {timeAgo(r.updated_at)}
                        </span>
                      </span>
                      <span className="text-[13px] font-medium text-accent">Import</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          </>
          )}
        </div>
      )}

      {/* ───────── Step 3: configure ───────── */}
      {step === 2 && (isImage ? imageReady : repo) && (
        <div className="space-y-6">
          <Card className="flex items-center gap-3 p-4">
            <span className="flex size-9 items-center justify-center rounded-lg border bg-secondary">
              {isImage ? <Container className="size-4" /> : <GithubIcon className="size-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn("truncate text-sm font-medium", isImage && "font-mono")}>{isImage ? image.trim() : repo!.full_name}</p>
              <p className="text-xs text-muted-foreground">{KINDS.find((k) => k.id === kind)?.title}{isImage ? " · Docker image" : framework ? ` · ${framework}` : ""}</p>
            </div>
            {!isImage && detecting && <Badge variant="accent" dot pulse>Detecting…</Badge>}
            <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
              Change
            </Button>
          </Card>

          <Card className="space-y-5 p-5">
            <h2 className="text-[15px] font-semibold">Project</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Project name" hint="Used for the default URL.">
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              {!isImage && (
              <>
              <Field label="Production branch">
                {branches.length > 0 ? (
                  <Select value={branch} onChange={(e) => setBranch(e.target.value)}>
                    {(branches.includes(branch) ? branches : [branch, ...branches]).map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                  </Select>
                ) : (
                  <Input value={branch} onChange={(e) => setBranch(e.target.value)} />
                )}
              </Field>
              <Field label="Root directory" hint="Leave empty unless the app lives in a sub-folder (monorepo).">
                <Input value={rootDir} onChange={(e) => setRootDir(e.target.value)} placeholder="apps/web" />
              </Field>
              <Field label="Framework">
                <Input value={framework} onChange={(e) => setFramework(e.target.value)} placeholder="Detected automatically" />
              </Field>
              </>
              )}
            </div>
          </Card>

          {isImage && kind !== "static" && (
            <Card className="space-y-5 p-5">
              <h2 className="text-[15px] font-semibold">Run</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {kind === "web_service" && (
                  <>
                    <Field label="Port" hint="Port the container listens on. Leave empty to use the port the image declares (EXPOSE). Orb also sets $PORT to it.">
                      <Input type="number" min={1} max={65535} value={imagePort} onChange={(e) => setImagePort(e.target.value)} placeholder="Auto-detect" aria-invalid={portInvalid} />
                    </Field>
                    <Field label="Health check path" hint="Must return a non-error status before traffic is switched.">
                      <Input className="font-mono text-[13px]" value={healthPath} onChange={(e) => setHealthPath(e.target.value)} />
                    </Field>
                  </>
                )}
                <Field label={kind === "cron" ? "Command" : "Command override"} hint={kind === "cron" ? "Runs inside the image on every schedule tick. Leave empty for the image default." : "Optional. Replaces the image's default command."} className={kind === "cron" ? "" : "sm:col-span-2"}>
                  <Input className="font-mono text-[13px]" value={startCmd} onChange={(e) => setStartCmd(e.target.value)} placeholder="Image default" />
                </Field>
                {kind === "cron" && (
                  <Field label="Schedule (cron)" hint="Minute hour day month weekday, e.g. 0 3 * * *">
                    <Input className="font-mono text-[13px]" value={schedule} onChange={(e) => setSchedule(e.target.value)} />
                  </Field>
                )}
              </div>
            </Card>
          )}

          {!isImage && (
          <Card className="space-y-5 p-5">
            <h2 className="text-[15px] font-semibold">Build & run</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Install command">
                <Input className="font-mono text-[13px]" value={installCmd} onChange={(e) => setInstallCmd(e.target.value)} placeholder="npm ci" />
              </Field>
              <Field label="Build command">
                <Input className="font-mono text-[13px]" value={buildCmd} onChange={(e) => setBuildCmd(e.target.value)} placeholder="npm run build" />
              </Field>
              {kind === "static" ? (
                <Field label="Output directory" hint="Folder that contains the built site.">
                  <Input className="font-mono text-[13px]" value={outputDir} onChange={(e) => setOutputDir(e.target.value)} placeholder="dist" />
                </Field>
              ) : (
                <Field label={kind === "cron" ? "Command" : "Start command"}>
                  <Input className="font-mono text-[13px]" value={startCmd} onChange={(e) => setStartCmd(e.target.value)} placeholder="npm run start" />
                </Field>
              )}
              {kind === "web_service" && (
                <>
                  <Field label="Port" hint="Your app must listen on $PORT (0.0.0.0).">
                    <Input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} />
                  </Field>
                  <Field label="Health check path" hint="Must return a non-error status before traffic is switched.">
                    <Input className="font-mono text-[13px]" value={healthPath} onChange={(e) => setHealthPath(e.target.value)} />
                  </Field>
                </>
              )}
              {kind === "cron" && (
                <Field label="Schedule (cron)" hint="Minute hour day month weekday, e.g. 0 3 * * *">
                  <Input className="font-mono text-[13px]" value={schedule} onChange={(e) => setSchedule(e.target.value)} />
                </Field>
              )}
            </div>
          </Card>
          )}

          {isServer && (
            <Card className="space-y-4 p-5">
              <h2 className="text-[15px] font-semibold">Instance size</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {Object.values(INSTANCE_PLANS).map((p) => {
                  const allowed = plan.allowedInstancePlans.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      disabled={!allowed}
                      onClick={() => setInstancePlan(p.id)}
                      aria-pressed={instancePlan === p.id}
                      className={cn(
                        "rounded-lg border p-3.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50",
                        instancePlan === p.id ? "border-accent ring-2 ring-accent/30" : "hover:border-foreground/30",
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{p.name}</span>
                        {!allowed && <Badge variant="outline">Upgrade</Badge>}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {p.cpuMillis / 1000} vCPU · {p.memoryMb >= 1024 ? `${p.memoryMb / 1024} GB` : `${p.memoryMb} MB`} RAM
                      </p>
                    </button>
                  );
                })}
              </div>
            </Card>
          )}

          <Card className="space-y-3 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">Environment variables</h2>
              {env.vars.length > 0 && <Badge variant="accent">{env.vars.length} detected</Badge>}
            </div>
            <Textarea
              rows={5}
              value={envText}
              onChange={(e) => setEnvText(e.target.value)}
              placeholder={"Paste your .env contents here\nAPI_URL=https://api.example.com\nSECRET_KEY=…"}
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">
              {isImage
                ? "Passed to your container when it starts. Stored encrypted and marked sensitive. You can add or change them any time under Project → Environment, then redeploy."
                : "Stored encrypted and marked sensitive. You can edit them later under Project → Environment."}
            </p>
            {env.skipped.length > 0 && <p className="text-xs text-warning">Ignored invalid or reserved keys: {env.skipped.join(", ")}</p>}
          </Card>

          {error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

          <div className="sticky bottom-4 flex items-center justify-between gap-3 rounded-xl border bg-card/90 p-3 shadow-lg backdrop-blur">
            <Button variant="ghost" onClick={() => setStep(1)}>
              <ArrowLeft /> Back
            </Button>
            <Button size="lg" variant="accent" onClick={submit} loading={submitting} disabled={name.trim().length < 2 || portInvalid}>
              <Rocket /> Create & deploy
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

