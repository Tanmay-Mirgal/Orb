import { App } from "@octokit/app";
import { Octokit } from "@octokit/rest";

// Initialize the GitHub App
const appId = process.env.GITHUB_APP_ID;
const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;

if (!appId || !privateKey) {
  console.warn("GitHub App credentials are not fully configured in environment variables.");
}

export const githubApp = new App({
  appId: appId || "",
  privateKey: privateKey || "",
});

export class GitHubService {
  /**
   * Fetches the user's repositories that the GitHub App has access to.
   * Note: For MVP, we fetch the first installation for the app and use its token.
   * In a multi-tenant production app, you would map the logged-in user to their specific installation ID.
   */
  static async getRepositories() {
    try {
      // 1. Get all installations for this app
      const { data: installations } = await githubApp.octokit.request("GET /app/installations");
      
      if (installations.length === 0) {
        return { error: "No installations found", repos: [] };
      }

      // 2. Get the first installation (or filter by user if mapped)
      const installationId = installations[0].id;
      
      // 3. Get an authenticated Octokit instance for this installation
      const octokit = await githubApp.getInstallationOctokit(installationId);
      
      // 4. Fetch repositories accessible to this installation
      const { data: repos } = await (octokit as any).rest.apps.listReposAccessibleToInstallation({
        per_page: 100,
      });

      return { error: null, repos: repos.repositories };
    } catch (error) {
      console.error("Failed to fetch GitHub repositories:", error);
      return { error: "Failed to connect to GitHub", repos: [] };
    }
  }

  static async getBranches(repoOwner: string, repoName: string) {
    try {
      const { data: installations } = await githubApp.octokit.request("GET /app/installations");
      if (installations.length === 0) return { error: "No installations", branches: [] };
      
      const installationId = installations[0].id;
      const octokit = await githubApp.getInstallationOctokit(installationId);
      
      const { data: branches } = await (octokit as any).rest.repos.listBranches({
        owner: repoOwner,
        repo: repoName,
      });
      
      return { error: null, branches };
    } catch (error) {
      console.error(`Failed to fetch branches for ${repoOwner}/${repoName}:`, error);
      return { error: "Failed to fetch branches", branches: [] };
    }
  }
}
