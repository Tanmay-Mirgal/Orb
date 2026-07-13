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

    // 2. Try fetching package.json
    let packageJsonStr = "";
    let isNode = false;
    let isFlask = false;

    const pkgRes = await fetch(
      `https://api.github.com/repos/${repoFullName}/contents/${packageJsonPath}`,
      { headers: { Authorization: `Bearer ${githubAccount.accessToken}`, Accept: "application/vnd.github.v3+json" } }
    );

    if (pkgRes.ok) {
      const fileData = await pkgRes.json();
      packageJsonStr = Buffer.from(fileData.content, 'base64').toString('utf-8');
      isNode = true;
    } else {
      // 3. If no package.json, check for requirements.txt for Flask
      const reqPath = rootDir ? `${rootDir}/requirements.txt` : "requirements.txt";
      const reqRes = await fetch(
        `https://api.github.com/repos/${repoFullName}/contents/${reqPath}`,
        { headers: { Authorization: `Bearer ${githubAccount.accessToken}`, Accept: "application/vnd.github.v3+json" } }
      );
      if (reqRes.ok) {
        isFlask = true;
      }
    }

    let framework = "Node.js";
    let buildCommand = "";
    let outputDirectory = ".";
    let installCommand = "";

    if (isFlask) {
      framework = "Flask";
      buildCommand = ""; // No build for standard flask
      installCommand = "pip install -r requirements.txt";
      outputDirectory = ".";
    } else if (isNode) {
      const packageJson = JSON.parse(packageJsonStr);
      const deps = { ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) };
      const scripts = packageJson.scripts || {};

      installCommand = "npm install";
      buildCommand = scripts.build ? "npm run build" : "";

      if (deps["next"]) {
        framework = "Next.js";
        outputDirectory = ".next/standalone";
      } else if (deps["react"] || deps["react-dom"] || deps["vite"]) {
        framework = "React.js";
        outputDirectory = deps["vite"] ? "dist" : "build";
      } else {
        framework = "Node.js";
        outputDirectory = ".";
      }
    } else {
      // Default to Node.js if nothing found
      framework = "Node.js";
      installCommand = "npm install";
      outputDirectory = ".";
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
