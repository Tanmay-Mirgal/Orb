import { simpleGit, SimpleGit } from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';

export class GitService {
  private git: SimpleGit;

  constructor() {
    this.git = simpleGit();
  }

  async cloneRepository(repoUrl: string, targetPath: string, branch: string = 'main', githubToken?: string): Promise<void> {
    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }
    fs.mkdirSync(targetPath, { recursive: true });

    let urlToClone = repoUrl;
    if (githubToken) {
      // Inject token if it's a github repo and token is provided
      if (urlToClone.startsWith('https://github.com/')) {
        urlToClone = urlToClone.replace('https://', `https://${githubToken}@`);
      }
    }

    await this.git.clone(urlToClone, targetPath, ['--branch', branch, '--single-branch', '--depth', '1']);
  }
}
