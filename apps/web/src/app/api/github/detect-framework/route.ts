import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { accounts } from "database";
import { eq } from "drizzle-orm";

export async function GET(req: Request) {
  try {
    const session = await auth.api.getSession({
      headers: req.headers,
    });

    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const repoFullName = searchParams.get("repo");
    let rootDir = searchParams.get("rootDir") || "";

    if (!repoFullName) {
      return NextResponse.json({ error: "Missing repository" }, { status: 400 });
    }

    // Clean up rootDir
    rootDir = rootDir.replace(/^\.?\//, ""); // Remove leading ./ or /
    if (rootDir.endsWith("/")) {
      rootDir = rootDir.slice(0, -1);
    }
    
    const packageJsonPath = rootDir ? `${rootDir}/package.json` : "package.json";

    // 1. Get user's GitHub access token
    const userAccounts = await db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, session.user.id));

    const githubAccount = userAccounts.find(a => a.providerId === "github");

    if (!githubAccount || !githubAccount.accessToken) {
      return NextResponse.json({ error: "No GitHub connection found" }, { status: 400 });
    }

    // 2. Fetch package.json from GitHub
    const githubRes = await fetch(
      `https://api.github.com/repos/${repoFullName}/contents/${packageJsonPath}`,
      {
        headers: {
          Authorization: `Bearer ${githubAccount.accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );

    if (!githubRes.ok) {
      if (githubRes.status === 404) {
        return NextResponse.json({ 
          success: true, 
          framework: "Other", 
          buildCommand: "npm run build", 
          outputDirectory: "dist",
          installCommand: "npm install"
        });
      }
      return NextResponse.json({ error: "Failed to fetch from GitHub" }, { status: githubRes.status });
    }

    const fileData = await githubRes.json();
    
    // GitHub API returns content as base64
    const packageJsonStr = Buffer.from(fileData.content, 'base64').toString('utf-8');
    const packageJson = JSON.parse(packageJsonStr);

    const deps = { ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) };
    const scripts = packageJson.scripts || {};

    let framework = "Node.js";
    let buildCommand = scripts.build ? "npm run build" : "";
    let outputDirectory = "dist";
    let installCommand = "npm install"; // Default

    // Simple Framework Detection Logic
    if (deps["next"]) {
      framework = "Next.js";
      outputDirectory = ".next";
    } else if (deps["vite"]) {
      framework = "Vite";
      outputDirectory = "dist";
    } else if (deps["@angular/core"]) {
      framework = "Angular";
      outputDirectory = "dist/app";
    } else if (deps["vue"]) {
      framework = "Vue";
      outputDirectory = "dist";
    } else if (deps["react"] || deps["react-dom"]) {
      framework = "React";
      outputDirectory = "build"; // Create React App default
    }

    return NextResponse.json({
      success: true,
      framework,
      buildCommand,
      outputDirectory,
      installCommand,
    });

  } catch (error) {
    console.error("Detect framework error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
